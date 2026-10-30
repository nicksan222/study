import { StudyError } from '@study/contracts/errors';
import { Clock, Effect, Schema } from 'effect';

import { requestBytes, runHttpPromise } from '#server/platform/http/index';
import { liveClock } from '#server/platform/time/index';

export interface Account {
  subject: string;
  clientId: string;
  refreshToken: string | null;
  sharing: boolean;
  email?: string;
}

export interface AuthOptions {
  issuer: string;
  /** Atomically replace account.refreshToken with refreshToken only if the saved sign-in still matches account; reject otherwise. */
  saveRefresh: (account: Account, refreshToken: string) => Promise<void>;
  fetch?: typeof fetch;
  clock?: Clock.Clock;
}

export interface AccessSeed {
  accessToken: string;
  expiresIn: number;
}

const tokensSchema = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number)
});

interface Access {
  value: string;
  renewAt: number;
}

function accessToken(value: string, lifetimeSeconds: number, clock: Clock.Clock): Access {
  const lifetime = Math.max(0, lifetimeSeconds) * 1000;

  return {
    value,
    renewAt: clock.currentTimeMillisUnsafe() + Math.max(lifetime - 300_000, lifetime / 2)
  };
}

class Session {
  private account: Account;
  private access?: Access;
  private dirty = false;
  private persistedRefreshToken: string | null;
  private active = true;
  private pending?: Promise<string>;
  private readonly knownTokens = new Set<string>();
  private options: AuthOptions;
  private readonly clock: Clock.Clock;

  constructor(account: Account, options: AuthOptions, seed?: AccessSeed) {
    this.account = { ...account };
    this.persistedRefreshToken = account.refreshToken;

    if (account.refreshToken) this.knownTokens.add(account.refreshToken);

    this.options = options;
    this.clock = options.clock ?? liveClock();

    if (seed?.accessToken) this.access = accessToken(seed.accessToken, seed.expiresIn, this.clock);
  }

  stop(): void {
    this.active = false;
    this.access = undefined;
  }

  async settle(): Promise<void> {
    await this.pending?.catch(() => {});
    await this.persist();
  }

  currentAccount(requested: Account): Account {
    if (
      requested.subject === this.account.subject &&
      requested.clientId === this.account.clientId &&
      requested.refreshToken &&
      this.knownTokens.has(requested.refreshToken)
    ) {
      return { ...requested, refreshToken: this.account.refreshToken };
    }

    return requested;
  }

  private assertActive(): void {
    if (!this.active) throw new StudyError('auth', 'ChatGPT session invalidated');
  }

  token(): Promise<string> {
    this.assertActive();

    if (!this.account.sharing)
      return Promise.reject(new StudyError('auth', 'ChatGPT plan is not shared'));

    if (!this.dirty && this.access && this.clock.currentTimeMillisUnsafe() < this.access.renewAt)
      return Promise.resolve(this.access.value);

    if (!this.pending) {
      const pending = this.renew();

      this.pending = pending;
      void pending
        .finally(() => {
          if (this.pending === pending) this.pending = undefined;
        })
        .catch(() => {});
    }

    return this.pending;
  }

  refused(token: string): void {
    if (this.access?.value === token) this.access = undefined;
  }

  private async persist(): Promise<void> {
    if (!this.dirty) return;

    await this.options.saveRefresh(
      { ...this.account, refreshToken: this.persistedRefreshToken },
      this.account.refreshToken!
    );
    this.persistedRefreshToken = this.account.refreshToken;
    this.dirty = false;
  }

  private async renew(): Promise<string> {
    await this.persist();
    this.assertActive();

    if (this.access && this.clock.currentTimeMillisUnsafe() < this.access.renewAt)
      return this.access.value;

    if (!this.account.refreshToken) throw new StudyError('auth', 'ChatGPT is not signed in');

    const response = await runHttpPromise(
      requestBytes(`${this.options.issuer.replace(/\/$/, '')}/api/accounts/oauth/token`, {
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.account.refreshToken,
          client_id: this.account.clientId
        }).toString(),
        timeoutMs: 30_000,
        maxBytes: 1024 * 1024,
        fetch: this.options.fetch
      }).pipe(Effect.provideService(Clock.Clock, this.clock))
    );

    if (response.status < 200 || response.status >= 300)
      throw new StudyError(
        [400, 401, 403].includes(response.status)
          ? 'auth'
          : response.status === 429
            ? 'rate_limited'
            : 'transient',
        'ChatGPT token refresh failed'
      );

    let tokens: typeof tokensSchema.Type;

    try {
      tokens = Schema.decodeUnknownSync(Schema.fromJsonString(tokensSchema))(
        new TextDecoder().decode(response.bytes)
      );
    } catch {
      throw new Error('Invalid ChatGPT token response');
    }

    if (!tokens || typeof tokens !== 'object') throw new Error('Invalid ChatGPT token response');

    if (tokens.refresh_token) {
      this.account.refreshToken = tokens.refresh_token;
      this.knownTokens.add(tokens.refresh_token);
      this.dirty = true;
    }

    if (typeof tokens.access_token === 'string' && tokens.access_token)
      this.access = accessToken(tokens.access_token, tokens.expires_in ?? 3600, this.clock);

    await this.persist();

    if (typeof tokens.access_token !== 'string' || !tokens.access_token)
      throw new Error('Empty ChatGPT access token');

    this.assertActive();

    return tokens.access_token;
  }
}

/** One process-wide owner of the active sign-in and all its refreshes. */
export class AuthManager {
  private static owner = false;
  private options: AuthOptions;
  private session?: Session;
  private transition?: Promise<void>;
  private disposal?: Promise<void>;
  private closing = false;
  private closed = false;

  constructor(options: AuthOptions) {
    if (AuthManager.owner) throw new Error('ChatGPT auth owner already exists');

    AuthManager.owner = true;
    this.options = options;
  }

  get clock(): Clock.Clock {
    return this.options.clock ?? liveClock();
  }

  private accepting = false;

  replace(account: Account, seed?: AccessSeed): Promise<void> {
    return this.change(account, seed);
  }

  signOut(): Promise<void> {
    return this.change();
  }

  private change(account?: Account, seed?: AccessSeed): Promise<void> {
    if (this.closing || this.closed)
      return Promise.reject(new Error('ChatGPT auth owner disposing or disposed'));

    if (this.transition)
      return Promise.reject(new Error('ChatGPT auth transition already in progress'));

    this.accepting = false;
    const old = this.session;

    old?.stop();
    const operation = (async () => {
      await old?.settle();

      if (this.closing) throw new Error('ChatGPT auth owner disposing');

      const current = account && old ? old.currentAccount(account) : account;

      this.session = current ? new Session(current, this.options, seed) : undefined;
      this.accepting = !!this.session;
    })();

    this.transition = operation;
    void operation
      .finally(() => {
        if (this.transition === operation) this.transition = undefined;
      })
      .catch(() => {});

    return operation;
  }

  token(): Promise<string> {
    if (!this.accepting || !this.session)
      return Promise.reject(new StudyError('auth', 'ChatGPT is not signed in'));

    return this.session.token();
  }

  refused(token: string): void {
    this.session?.refused(token);
  }

  dispose(): Promise<void> {
    if (this.closed) return Promise.resolve();

    if (this.disposal) return this.disposal;

    this.closing = true;
    this.accepting = false;
    this.session?.stop();
    const operation = (async () => {
      await this.transition?.catch(() => {});
      this.session?.stop();
      await this.session?.settle();
      this.session = undefined;
      this.closed = true;
      AuthManager.owner = false;
    })();

    this.disposal = operation;
    void operation.catch(() => {
      if (this.disposal === operation) this.disposal = undefined;
    });

    return operation;
  }
}

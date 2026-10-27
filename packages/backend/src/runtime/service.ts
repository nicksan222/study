import { randomUUID } from 'node:crypto';

import { AuthManager, SignIn } from '@study/ai';
import type { Account } from '@study/ai';

import { releaseWaiting as opReleaseWaiting } from '#backend/procedures/jobs/worker';
import {
  loadPreferences as opLoadPreferences,
  setPreference as opSetPreference,
  deletePreference as opDeletePreference
} from '#backend/procedures/settings/preferences';
import { StudyError } from '#backend/shared/errors/index';
import type { JsonValue } from '#backend/shared/json';

import { BackendContext } from './context.ts';
import { Workers } from './workers.ts';

const PRIVATE = 'private.chatgpt';

const same = (a: Account, b: Account) =>
  a.subject === b.subject &&
  a.clientId === b.clientId &&
  a.refreshToken === b.refreshToken &&
  a.sharing === b.sharing &&
  a.email === b.email;

/** Owns one database and the process-wide ChatGPT session. */
export class App {
  private signin?: SignIn;
  private attemptId?: string;
  readonly workers: Workers;
  private finishing?: SignIn;
  private signInGeneration = 0;
  private authTransition = false;
  private closing = false;
  readonly store: BackendContext;
  private readonly auth: AuthManager;
  private readonly issuer: string;
  private readonly hostId: string;
  private readonly fetch?: typeof fetch;

  private constructor(
    store: BackendContext,
    auth: AuthManager,
    issuer: string,
    hostId: string,
    fetch?: typeof globalThis.fetch
  ) {
    this.store = store;
    this.workers = new Workers(store, auth, fetch);
    this.auth = auth;
    this.issuer = issuer;
    this.hostId = hostId;
    this.fetch = fetch;
  }

  static async open(options: {
    path: string;
    issuer?: string;
    hostId?: string;
    fetch?: typeof fetch;
  }): Promise<App> {
    const store = BackendContext.open(options.path);
    let auth: AuthManager | undefined;

    try {
      const issuer = options.issuer ?? 'https://auth.openai.com';

      auth = new AuthManager({
        issuer,
        fetch: options.fetch,
        saveRefresh: async (previous, token) => {
          store.transaction(() => {
            const saved = opLoadPreferences(store, PRIVATE).account as unknown as
              | Account
              | undefined;

            if (!saved) throw new Error('Sign-in changed during refresh');

            if (
              same(saved, {
                ...previous,
                refreshToken: token
              })
            )
              return;

            if (!same(saved, previous)) throw new Error('Sign-in changed during refresh');

            opSetPreference(store, PRIVATE, 'account', {
              ...previous,
              refreshToken: token
            } as unknown as JsonValue);
          });
        }
      });
      const account = opLoadPreferences(store, PRIVATE).account as unknown as Account | undefined;

      if (account) await auth.replace(account);

      return new App(store, auth, issuer, options.hostId ?? 'study', options.fetch);
    } catch (error) {
      await auth?.dispose();
      store.close();

      throw error;
    }
  }

  async close() {
    this.closing = true;
    await this.workers.stop();
    this.cancelSignIn();

    if (this.authTransition) throw new Error('Auth transition in progress; retry close');

    await this.auth.dispose();
    this.store.close();
  }

  subscribe(listener: () => void) {
    return this.store.subscribe(listener);
  }

  signInStatus() {
    const account = opLoadPreferences(this.store, PRIVATE).account as unknown as
      | Account
      | undefined;

    return account
      ? {
          signedIn: true,
          email: account.email ?? null,
          sharing: account.sharing
        }
      : {
          signedIn: false,
          email: null,
          sharing: false
        };
  }

  async startSignIn(reconsent = false) {
    if (this.closing) throw new Error('App is closing');

    this.cancelSignIn();
    const generation = this.signInGeneration;
    const signin = await SignIn.start({
      issuer: this.issuer,
      hostId: this.hostId,
      reconsent,
      fetch: this.fetch
    });

    if (this.closing || generation !== this.signInGeneration) {
      signin.dispose();

      throw new Error('Sign-in cancelled');
    }

    this.signin = signin;
    this.attemptId = randomUUID();

    return {
      url: signin.url,
      attemptId: this.attemptId
    };
  }

  async finishSignIn(signal?: AbortSignal, attemptId?: string) {
    if (attemptId !== undefined && attemptId !== this.attemptId)
      throw new StudyError('invalid_input', 'Unknown sign-in attempt');

    const signin = this.signin;

    if (!signin) throw new Error('Sign-in has not started');

    if (this.finishing === signin)
      throw new StudyError('invalid_input', 'Sign-in is already finishing');

    this.finishing = signin;

    try {
      const result = await signin.finish(300_000, signal);

      if (this.closing || this.signin !== signin || signal?.aborted)
        throw new StudyError('cancelled', 'Sign-in cancelled');

      if (this.authTransition)
        throw new StudyError('invalid_input', 'Sign-in transition in progress');

      this.authTransition = true;

      try {
        const before = opLoadPreferences(this.store, PRIVATE).account as unknown as
          | Account
          | undefined;

        await this.auth.replace(result.account, result);
        const after = opLoadPreferences(this.store, PRIVATE).account as unknown as
          | Account
          | undefined;
        const account =
          before && after && same(before, result.account) && !same(before, after)
            ? {
                ...result.account,
                refreshToken: after.refreshToken
              }
            : result.account;

        try {
          if (signal?.aborted || this.closing || this.signin !== signin)
            throw new StudyError('cancelled', 'Sign-in cancelled');

          opSetPreference(this.store, PRIVATE, 'account', account as unknown as JsonValue);
        } catch (error) {
          try {
            if (after) await this.auth.replace(after);
            else await this.auth.signOut();
          } catch {
            await this.auth.signOut();
          }

          throw error;
        }

        opReleaseWaiting(this.store);
        this.workers.wake();

        return this.signInStatus();
      } finally {
        this.authTransition = false;
      }
    } finally {
      if (this.signin === signin) this.signin = undefined;

      if (this.finishing === signin) this.finishing = undefined;

      signin.dispose();
    }
  }

  cancelSignIn(attemptId?: string) {
    if (attemptId !== undefined && attemptId !== this.attemptId) return false;

    this.signInGeneration++;
    this.signin?.dispose();
    this.signin = undefined;
    this.attemptId = undefined;

    return true;
  }

  publicAccount() {
    const account = opLoadPreferences(this.store, PRIVATE).account as unknown as
      | Account
      | undefined;

    return account
      ? {
          subject: account.subject,
          email: account.email ?? undefined,
          sharing: account.sharing
        }
      : undefined;
  }

  async signOut() {
    if (this.closing || this.authTransition) throw new Error('Auth transition in progress');

    this.cancelSignIn();
    this.authTransition = true;

    try {
      await this.auth.signOut();
      opDeletePreference(this.store, PRIVATE, 'account');
    } finally {
      this.authTransition = false;
    }
  }
}

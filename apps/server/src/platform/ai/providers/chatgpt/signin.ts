import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { StudyError } from '@study/contracts/errors';
import { text } from '@study/localization';
import { Clock, Effect, Schema } from 'effect';

import type { Account } from '#server/platform/ai/providers/chatgpt/session';
import { requestBytes, runHttpPromise } from '#server/platform/http/index';
import { liveClock } from '#server/platform/time/index';

import { assertTokenResponse } from './token-response.ts';

const claimsSchema = Schema.Struct({
  iss: Schema.String,
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  sub: Schema.String,
  nonce: Schema.String,
  exp: Schema.Number,
  email: Schema.optional(Schema.String)
});

const random = () => randomBytes(32).toString('base64url');

const resource = 'https://api.openai.com/v1';

const dynamicClient = 'dynamic_agent_client';

export interface SignInOptions {
  issuer: string;
  hostId: string;
  clientId?: string;
  reconsent?: boolean;
  fetch?: typeof fetch;
  lifetimeMs?: number;
  clock?: Clock.Clock;
}

export interface SignInResult {
  account: Account;
  accessToken: string;
  expiresIn: number;
}

/** A single-use loopback OAuth authorization with PKCE. */
export class SignIn {
  readonly url: string;
  private readonly server: Server;
  private readonly options: SignInOptions;
  private readonly redirect: string;
  private readonly verifier: string;
  private readonly state: string;
  private readonly nonce: string;
  private callback: Promise<{ code: string; clientId?: string }>;
  private used = false;
  private readonly controller = new AbortController();

  private constructor(
    server: Server,
    options: SignInOptions,
    redirect: string,
    verifier: string,
    state: string,
    nonce: string,
    callback: Promise<{ code: string; clientId?: string }>
  ) {
    this.server = server;
    this.options = options;
    this.redirect = redirect;
    this.verifier = verifier;
    this.state = state;
    this.nonce = nonce;
    this.callback = callback;
    const clientId = options.clientId ?? dynamicClient;
    const url = new URL(`${options.issuer.replace(/\/$/, '')}/api/accounts/authorize`);
    const params: Record<string, string> = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state,
      nonce,
      resource,
      ext_agent_host_id: options.hostId
    };

    if (clientId === dynamicClient) params.agent_name_hint = 'Study';

    if (options.reconsent) params.force_reconsent = 'true';

    url.search = new URLSearchParams(params).toString();
    this.url = url.toString();
  }

  static async start(options: SignInOptions): Promise<SignIn> {
    new URL(`${options.issuer.replace(/\/$/, '')}/api/accounts/authorize`);
    const verifier = random(),
      state = random(),
      nonce = random();
    let resolve!: (value: { code: string; clientId?: string }) => void;
    let reject!: (error: Error) => void;
    const callback = new Promise<{ code: string; clientId?: string }>((yes, no) => {
      resolve = yes;
      reject = no;
    });

    void callback.catch(() => {});
    const page = (message: 'LlmChatGptBrowserDone' | 'LlmChatGptBrowserFailed') =>
      `<!doctype html><meta charset=utf-8><title>Study</title><p>${[text('english', message), text('italian', message)].map((value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')).join('<br>')}</p>`;
    const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname !== '/auth/callback') {
        response.writeHead(404).end();

        return;
      }

      if (url.searchParams.get('state') !== state) {
        response.writeHead(400).end(page('LlmChatGptBrowserFailed'));
        reject(new Error('Sign-in state mismatch'));

        return;
      }

      const code = url.searchParams.get('code');

      if (!code || url.searchParams.has('error')) {
        response.writeHead(400).end(page('LlmChatGptBrowserFailed'));
        reject(new Error('Sign-in declined'));

        return;
      }

      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(page('LlmChatGptBrowserDone'));
      resolve({
        code,
        clientId: url.searchParams.get('client_id') ?? undefined
      });
    });

    server.requestTimeout = 30_000;
    server.headersTimeout = 30_000;
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });
    const address = server.address();

    if (!address || typeof address === 'string') {
      server.close();

      throw new Error('Cannot open sign-in listener');
    }

    return new SignIn(
      server,
      options,
      `http://127.0.0.1:${address.port}/auth/callback`,
      verifier,
      state,
      nonce,
      callback
    );
  }

  dispose(reason: Error = new Error('Sign-in cancelled')): void {
    if (this.controller.signal.aborted) return;

    this.controller.abort(reason);

    this.server.closeAllConnections();
    this.server.close();
  }

  // fallow-ignore-next-line unused-class-member -- Auth service calls finish on the scoped sign-in; signin.test.ts exercises the OAuth exchange.
  async finish(timeoutMs: number, signal?: AbortSignal): Promise<SignInResult> {
    if (this.used) throw new Error('Sign-in already finished');

    this.used = true;
    const abort = signal
      ? AbortSignal.any([this.controller.signal, signal])
      : this.controller.signal;

    try {
      const { response, clientId } = await runHttpPromise(
        Effect.gen({ self: this }, function* () {
          const callback = yield* Effect.tryPromise({
            try: () => this.callback,
            catch: (error) => error
          });
          const clientId = callback.clientId ?? this.options.clientId ?? dynamicClient;

          if (clientId === dynamicClient)
            return yield* Effect.fail(new StudyError('config', 'OpenAI issued no client id'));

          const form = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code: callback.code,
            code_verifier: this.verifier,
            redirect_uri: this.redirect,
            resource
          });
          const response = yield* requestBytes(
            `${this.options.issuer.replace(/\/$/, '')}/api/accounts/oauth/token`,
            {
              body: form.toString(),
              timeoutMs: 30_000,
              maxBytes: 1024 * 1024,
              fetch: this.options.fetch
            }
          );

          return { response, clientId };
        }).pipe(
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(new StudyError('transient', 'Sign-in timed out'))
          }),
          Effect.provideService(Clock.Clock, this.options.clock ?? liveClock())
        ),
        { signal: abort }
      ).catch((error: unknown) => {
        if (abort.aborted) throw abort.reason;

        throw error;
      });

      assertTokenResponse(response.status, 'Sign-in token exchange failed');

      return signInResult(response.bytes, clientId, this.options, this.nonce);
    } finally {
      this.dispose();
    }
  }
}

/** Acquire a loopback listener whose expiry and release belong to the caller's scope. */
export const acquireSignIn = (options: SignInOptions) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const signin = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => SignIn.start({ ...options, clock: options.clock ?? clock }),
        catch: (error) => error
      }),
      (value) => Effect.sync(() => value.dispose())
    );

    yield* Effect.forkScoped(
      Effect.sleep(options.lifetimeMs ?? 300_000).pipe(
        Effect.andThen(Effect.sync(() => signin.dispose(new Error('Sign-in expired'))))
      )
    );

    return signin;
  });

function signInResult(
  bytes: Uint8Array,
  clientId: string,
  options: SignInOptions,
  nonce: string
): SignInResult {
  const tokenSchema = Schema.Struct({
    id_token: Schema.optional(Schema.String),
    access_token: Schema.optional(Schema.String),
    refresh_token: Schema.optional(Schema.String),
    expires_in: Schema.optional(Schema.Number),
    scope: Schema.optional(Schema.String)
  });
  let tokens: typeof tokenSchema.Type;

  try {
    tokens = Schema.decodeUnknownSync(Schema.fromJsonString(tokenSchema))(
      new TextDecoder().decode(bytes)
    );
  } catch {
    throw new Error('Invalid sign-in token response');
  }

  if (!tokens || typeof tokens !== 'object') throw new Error('Invalid sign-in token response');

  const claims = readIdClaims(tokens.id_token);

  assertIdClaims(claims, options, clientId, nonce);

  if (!tokens.access_token) throw new Error('Empty ChatGPT access token');

  return {
    account: {
      subject: claims.sub,
      clientId,
      email: claims.email,
      sharing: !!tokens.scope?.split(/\s+/).includes('chatgpt.tokens.use.direct'),
      refreshToken: tokens.refresh_token ?? null
    },
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in ?? 3600
  };
}

function readIdClaims(idToken: string | undefined) {
  const payload = idToken?.split('.')[1];

  if (!payload) throw new Error('Invalid ID token');

  let claims: typeof claimsSchema.Type;

  try {
    claims = Schema.decodeUnknownSync(Schema.fromJsonString(claimsSchema))(
      Buffer.from(payload, 'base64url').toString()
    );
  } catch {
    throw new Error('Invalid ID token');
  }

  if (!claims || typeof claims !== 'object') throw new Error('Invalid ID token');

  return claims;
}

function assertIdClaims(
  claims: typeof claimsSchema.Type,
  options: SignInOptions,
  clientId: string,
  nonce: string
) {
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (
    claims.iss?.replace(/\/$/, '') !== options.issuer.replace(/\/$/, '') ||
    !audience.includes(clientId) ||
    claims.nonce !== nonce ||
    !claims.sub ||
    !(claims.exp > (options.clock ?? liveClock()).currentTimeMillisUnsafe() / 1000)
  )
    throw new Error('Invalid ID token claims');
}

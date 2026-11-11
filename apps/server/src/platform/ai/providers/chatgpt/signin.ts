/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Implements single-use loopback OAuth authorization with PKCE for the ChatGPT       │
 * │ account flow. It validates callback state and identity claims, exchanges the code, and   │
 * │ returns the account plus seeded access token.                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports SignInOptions, SignInResult, SignIn, acquireSignIn. It validates callback      │
 * │   state and identity claims, exchanges the code, and returns the account plus seeded     │
 * │   access token.                                                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ ChatGptSession and model construction consume this provider API; OAuth transport uses    │
 * │ platform/http and persisted credentials remain in Auth-owned storage.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { signInCallbackUrlSchema } from '@study/contracts/auth/schemas';
import { StudyError } from '@study/contracts/errors';
import { text } from '@study/localization';
import { CryptoHasher, serve } from 'bun';
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

const tokenSchema = Schema.Struct({
  id_token: Schema.optional(Schema.String),
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String)
});

const decodeSignInTokens = Schema.decodeUnknownSync(Schema.fromJsonString(tokenSchema));

const decodeIdClaims = Schema.decodeUnknownSync(Schema.fromJsonString(claimsSchema));

const random = () =>
  crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: 'base64url', omitPadding: true });

const resource = 'https://api.openai.com/v1';

const dynamicClient = 'dynamic_agent_client';

export interface SignInOptions {
  issuer: string;
  hostId: string;
  clientId?: string;
  callbackUrl?: string;
  reconsent?: boolean;
  fetch?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
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
  private readonly server: { stop(closeActiveConnections?: boolean): void } | undefined;
  private readonly receiveCallback: (params: URLSearchParams) => boolean;
  private readonly options: SignInOptions;
  private readonly redirect: string;
  private readonly verifier: string;
  private readonly state: string;
  private readonly nonce: string;
  private callback: Promise<{ code: string; clientId?: string }>;
  private used = false;
  private readonly controller = new AbortController();

  private constructor(
    server: { stop(closeActiveConnections?: boolean): void } | undefined,
    options: SignInOptions,
    redirect: string,
    verifier: string,
    state: string,
    nonce: string,
    callback: Promise<{ code: string; clientId?: string }>,
    receiveCallback: (params: URLSearchParams) => boolean
  ) {
    this.server = server;
    this.options = options;
    this.redirect = redirect;
    this.verifier = verifier;
    this.state = state;
    this.nonce = nonce;
    this.callback = callback;
    this.receiveCallback = receiveCallback;
    const clientId = options.clientId ?? dynamicClient;
    const url = new URL(`${options.issuer.replace(/\/$/, '')}/api/accounts/authorize`);
    const params: Record<string, string> = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      code_challenge: new CryptoHasher('sha256').update(verifier).digest('base64url'),
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

    if (options.callbackUrl !== undefined)
      Schema.decodeUnknownSync(signInCallbackUrlSchema)(options.callbackUrl);

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
    let delivered = false;
    const receiveCallback = (params: URLSearchParams): boolean => {
      if (delivered) return false;

      if (params.get('state') !== state) {
        reject(new Error('Sign-in state mismatch'));

        return false;
      }

      delivered = true;
      const code = params.get('code');

      if (!code || params.has('error')) {
        reject(new Error('Sign-in declined'));

        return false;
      }

      resolve({ code, clientId: params.get('client_id') ?? undefined });

      return true;
    };
    const server = options.callbackUrl
      ? undefined
      : serve({
          hostname: '127.0.0.1',
          port: 0,
          idleTimeout: 30,
          maxRequestBodySize: 16 * 1024,
          fetch(request) {
            const url = new URL(request.url);

            if (url.pathname !== '/auth/callback') return new Response(null, { status: 404 });

            const accepted = receiveCallback(url.searchParams);

            return new Response(signInCallbackPage(accepted), {
              status: accepted ? 200 : 400,
              headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
                'referrer-policy': 'no-referrer'
              }
            });
          }
        });
    const redirect =
      options.callbackUrl ?? (server ? `http://127.0.0.1:${server.port}/auth/callback` : undefined);

    if (!redirect) throw new Error('Cannot determine sign-in callback');

    return new SignIn(server, options, redirect, verifier, state, nonce, callback, receiveCallback);
  }

  /** Only the configured browser callback transport may submit the matching pending state. */
  acceptCallback(params: URLSearchParams): boolean {
    if (
      !this.options.callbackUrl ||
      this.controller.signal.aborted ||
      params.get('state') !== this.state
    )
      return false;

    return this.receiveCallback(params);
  }

  dispose(reason: Error = new Error('Sign-in cancelled')): void {
    if (this.controller.signal.aborted) return;

    this.controller.abort(reason);

    if (this.server) {
      const server = this.server;

      server.stop(false);
      // Let the accepted callback response flush before closing any stalled connections.
      void Bun.sleep(50).then(() => server.stop(true));
    }
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
  let tokens: typeof tokenSchema.Type;

  try {
    tokens = decodeSignInTokens(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Invalid sign-in token response');
  }

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
    claims = decodeIdClaims(Buffer.from(payload, 'base64url').toString());
  } catch {
    throw new Error('Invalid ID token');
  }

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

export function signInCallbackPage(accepted: boolean): string {
  const key = accepted ? 'LlmChatGptBrowserDone' : 'LlmChatGptBrowserFailed';

  return `<!doctype html><meta charset=utf-8><title>Study</title><p>${[text('english', key), text('italian', key)].map((value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')).join('<br>')}</p>`;
}

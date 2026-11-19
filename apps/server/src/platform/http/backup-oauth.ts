/** @file Owns the loopback PKCE exchange and bounded HTTP transport for cloud backups. */

import { StudyError } from '@study/contracts';
import { CryptoHasher, serve } from 'bun';
import { Option, Schema } from 'effect';

import { signInCallbackPage } from '#server/platform/ai/auth/index';

import { backupUploadTimeout } from './backup-storage-http.ts';
import { streamingFetch } from './index.ts';

const callbackPath = '/study-backup';

const random = () =>
  crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: 'base64url', omitPadding: true });

const tokens = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optionalKey(Schema.NonEmptyString)
});

type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

type OAuthProvider = {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  authorizeFields?: Readonly<Record<string, string>>;
  tokenFields?: Readonly<Record<string, string>>;
  callbackHost?: string;
  callbackPort?: number;
  requiresClientSecret?: boolean;
};

export function backupHttp(request?: Fetch) {
  return async (
    url: string | URL,
    init: RequestInit,
    options: { allow?: readonly number[]; upload?: boolean; token?: boolean } = {}
  ) => {
    const response = await streamingFetch(url, init, {
      timeoutMs: options.upload ? backupUploadTimeout(init.body, 5 * 60_000) : 45_000,
      maxBytes: 64 * 1024,
      fetch: request,
      sensitive: true
    }).catch(() => {
      throw new StudyError(
        init.signal?.aborted ? 'cancelled' : 'transient',
        'Backup provider request failed'
      );
    });

    if (response.ok || options.allow?.includes(response.status)) return response;

    await response.body?.cancel();
    const { status } = response;
    const kind =
      status === 429
        ? 'rate_limited'
        : status >= 500
          ? 'transient'
          : status === 401 || (options.token && status === 400)
            ? 'auth'
            : 'config';

    throw new StudyError(kind, `Backup provider returned HTTP ${status}`);
  };
}

export type BackupHttp = ReturnType<typeof backupHttp>;

export async function backupJson<S extends Schema.ConstraintDecoder<unknown>>(
  response: Response,
  schema: S
): Promise<S['Type']> {
  const json = await response.json().catch(() => undefined);
  const decoded = Schema.decodeUnknownOption(schema)(json);

  if (Option.isNone(decoded)) throw new StudyError('transient', 'Invalid backup provider response');

  return decoded.value;
}

function acceptCallback(
  request: Request,
  state: string,
  callback: { resolve: (code: string) => void; reject: (failure: StudyError) => void },
  accept: () => boolean
) {
  const url = new URL(request.url);

  if (url.pathname !== callbackPath || request.method !== 'GET')
    return new Response(null, { status: 404 });

  const params = url.searchParams;
  const valid = params.get('state') === state && accept();
  const code = params.get('code');
  const success = valid && Boolean(code) && !params.has('error');

  if (valid) {
    if (success && code) callback.resolve(code);
    else callback.reject(new StudyError('auth', 'Cloud backup authorization was declined'));
  }

  return new Response(signInCallbackPage(success), {
    status: success ? 200 : 400,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer'
    }
  });
}

function withSecret(provider: OAuthProvider, secret: string | undefined): Record<string, string> {
  if (!provider.requiresClientSecret) return {};

  if (!secret) throw new StudyError('config', 'Enter the OAuth desktop client secret');

  return { client_secret: secret };
}

export function oauthCodeFlow(provider: OAuthProvider, call: BackupHttp) {
  async function exchange(
    clientId: string,
    clientSecret: string | undefined,
    fields: Record<string, string>,
    signal: AbortSignal
  ) {
    const body = new URLSearchParams({
      ...fields,
      client_id: clientId,
      ...provider.tokenFields,
      ...withSecret(provider, clientSecret)
    });
    const response = await call(
      provider.tokenUrl,
      { method: 'POST', body, signal },
      { token: true }
    );

    return backupJson(response, tokens);
  }

  return {
    begin(clientId: string, clientSecret?: string) {
      withSecret(provider, clientSecret);

      const state = random();
      const verifier = random();
      const controller = new AbortController();
      const callback = Promise.withResolvers<string>();
      let accepted = false;

      void callback.promise.catch(() => {});
      const server = serve({
        hostname: '127.0.0.1',
        port: provider.callbackPort ?? 0,
        maxRequestBodySize: 4096,
        fetch: (request) =>
          acceptCallback(request, state, callback, () => {
            if (accepted) return false;

            accepted = true;

            return true;
          })
      });
      const redirect = `http://${provider.callbackHost ?? 'localhost'}:${server.port}${callbackPath}`;
      const url = new URL(provider.authorizeUrl);

      url.search = new URLSearchParams({
        ...provider.authorizeFields,
        client_id: clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: provider.scope,
        code_challenge: new CryptoHasher('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        state
      }).toString();

      function close() {
        if (controller.signal.aborted) return;

        controller.abort();
        void server.stop();
        callback.reject(new StudyError('cancelled', 'Cloud backup authorization ended'));
      }

      return {
        url: url.href,
        close,
        signal: controller.signal,
        finish: async (signal: AbortSignal) => {
          if (signal.aborted) close();

          signal.addEventListener('abort', close, { once: true });

          try {
            const code = await callback.promise;
            const response = await exchange(
              clientId,
              clientSecret,
              {
                grant_type: 'authorization_code',
                redirect_uri: redirect,
                code,
                code_verifier: verifier
              },
              AbortSignal.any([signal, controller.signal])
            );

            if (!response.refresh_token)
              throw new StudyError('auth', 'Cloud backup requires offline access');

            return response.refresh_token;
          } finally {
            signal.removeEventListener('abort', close);
          }
        }
      };
    },
    refresh: (clientId: string, refreshToken: string, signal: AbortSignal, clientSecret?: string) =>
      exchange(
        clientId,
        clientSecret,
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        signal
      )
  };
}

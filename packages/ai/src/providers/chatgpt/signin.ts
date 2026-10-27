import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { text } from '@study/localization';

import type { Account } from './session.ts';

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
  private timer?: ReturnType<typeof setTimeout>;

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
    this.timer = setTimeout(
      () => this.dispose(new Error('Sign-in expired')),
      options.lifetimeMs ?? 300_000
    );
    this.timer.unref();
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

    if (this.timer) clearTimeout(this.timer);

    this.server.closeAllConnections();
    this.server.close();
  }

  async finish(timeoutMs: number, signal?: AbortSignal): Promise<SignInResult> {
    if (this.used) throw new Error('Sign-in already finished');

    this.used = true;
    const abort = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(timeoutMs),
      ...(signal ? [signal] : [])
    ]);

    try {
      const callback = await Promise.race([
        this.callback,
        new Promise<never>((_, reject) => {
          if (abort.aborted) reject(abort.reason);
          else
            abort.addEventListener('abort', () => reject(abort.reason), {
              once: true
            });
        })
      ]);
      const clientId = callback.clientId ?? this.options.clientId ?? dynamicClient;

      if (clientId === dynamicClient) throw new Error('OpenAI issued no client id');

      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: callback.code,
        code_verifier: this.verifier,
        redirect_uri: this.redirect,
        resource
      });
      const response = await (this.options.fetch ?? fetch)(
        `${this.options.issuer.replace(/\/$/, '')}/api/accounts/oauth/token`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          signal: AbortSignal.any([abort, AbortSignal.timeout(30_000)])
        }
      );

      if (!response.ok) throw new Error(`Sign-in token exchange failed (${response.status})`);

      let tokens: {
        id_token: string;
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };

      try {
        tokens = (await response.json()) as typeof tokens;
      } catch {
        throw new Error('Invalid sign-in token response');
      }

      if (!tokens || typeof tokens !== 'object') throw new Error('Invalid sign-in token response');

      const payload = tokens.id_token?.split('.')[1];

      if (!payload) throw new Error('Invalid ID token');

      let claims: {
        iss: string;
        aud: string | string[];
        sub: string;
        nonce: string;
        exp: number;
        email?: string;
      };

      try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as typeof claims;
      } catch {
        throw new Error('Invalid ID token');
      }

      if (!claims || typeof claims !== 'object') throw new Error('Invalid ID token');

      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

      if (
        claims.iss?.replace(/\/$/, '') !== this.options.issuer.replace(/\/$/, '') ||
        !audience.includes(clientId) ||
        claims.nonce !== this.nonce ||
        !claims.sub ||
        !(claims.exp > Date.now() / 1000)
      )
        throw new Error('Invalid ID token claims');

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
    } finally {
      this.dispose();
    }
  }
}

import { StudyRpc } from '@study/contracts';
import { makeStudyClient, studySocketProtocol } from '@study/server/client';
import { serve } from '@study/server/runtime';
import { test } from '@study/testing';
import { Deferred, Effect, Exit, Fiber, Layer, Stream } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { createServer } from 'vite-plus';

import { studyRpcProxy } from './rpc-proxy.ts';

test.stable(
  'the browser dev proxy keeps appearance RPC connected across Vite restarts',
  async ({ databases, resources }) => {
    const database = await databases();
    const app = await resources.openApp({ path: database.path });
    const server = await serve(app);
    const web = await createServer({
      configFile: Bun.fileURLToPath(
        new URL('../../../apps/client/vite.config.ts', import.meta.url)
      ),
      server: { host: '127.0.0.1', port: 0, hmr: false, proxy: studyRpcProxy(server.url) },
      optimizeDeps: { noDiscovery: true }
    });

    try {
      await web.listen();
      const load = () =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* makeStudyClient(StudyRpc, {
                baseUrl: () => {
                  const address = web.httpServer?.address();

                  test.assert.ok(address && typeof address !== 'string');

                  return `http://127.0.0.1:${address.port}`;
                }
              });
              const settings = yield* client['settings.appSettings']({});
              const themes = yield* client['themes.themes']({ limit: 100 });

              test.assert.strictEqual(settings.appearance, 2);
              test.assert.ok(themes.items.some((theme) => theme.id === 't3-code' && theme.builtin));
            })
          )
        );

      await load();
      await web.restart();
      await load();
    } finally {
      await web.close();
      await server.close();
      await app.close();
    }
  }
);

test.stable(
  'browser OAuth completes through the forwarded web port and persists the account',
  async ({ databases, resources }) => {
    const database = await databases();
    let nonce = '';
    let callbackUrl = '';
    let exchanges = 0;
    const app = await resources.openApp({
      path: database.path,
      fetch: async (_url, init) => {
        const form = new URLSearchParams(init?.body as string);

        test.assert.strictEqual(form.get('redirect_uri'), callbackUrl);
        test.assert.strictEqual(form.get('client_id'), 'issued-client');
        test.assert.ok(form.get('code_verifier'));
        exchanges++;

        return Response.json({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          scope: 'openid chatgpt.tokens.use.direct',
          id_token: `e30.${Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'issued-client', sub: 'test-subject', email: 'learner@example.test', nonce, exp: Date.now() / 1000 + 3600 })).toString('base64url')}.sig`
        });
      }
    });
    const server = await serve(app);
    const web = await createServer({
      configFile: Bun.fileURLToPath(
        new URL('../../../apps/client/vite.config.ts', import.meta.url)
      ),
      server: { host: '127.0.0.1', port: 0, hmr: false, proxy: studyRpcProxy(server.url) },
      optimizeDeps: { noDiscovery: true }
    });

    try {
      await web.listen();
      const address = web.httpServer?.address();

      test.assert.ok(address && typeof address !== 'string');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      callbackUrl = `${baseUrl}/auth/callback`;
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl });
            const attempt = yield* client['auth.startSignIn']({ callbackUrl });
            const authorization = new URL(attempt.url);

            test.assert.strictEqual(authorization.searchParams.get('redirect_uri'), callbackUrl);
            nonce = authorization.searchParams.get('nonce')!;
            const redirect = new URL(callbackUrl);

            redirect.searchParams.set('state', authorization.searchParams.get('state')!);
            redirect.searchParams.set('code', 'test-authorization');
            redirect.searchParams.set('client_id', 'issued-client');
            const wrongState = new URL(redirect);

            wrongState.searchParams.set('state', 'stale-state');
            const rejected = yield* Effect.promise(() => fetch(wrongState));

            test.assert.strictEqual(rejected.status, 400);
            yield* Effect.promise(() => rejected.arrayBuffer());
            const response = yield* Effect.promise(() => fetch(redirect));

            test.assert.strictEqual(response.status, 200);
            test.assert.strictEqual(response.headers.get('cache-control'), 'no-store');
            test.assert.strictEqual(response.headers.get('referrer-policy'), 'no-referrer');
            yield* Effect.promise(() => response.arrayBuffer());
            const replay = yield* Effect.promise(() => fetch(redirect));

            test.assert.strictEqual(replay.status, 400);
            yield* Effect.promise(() => replay.arrayBuffer());
            const result = yield* client['auth.finishSignIn']({ attemptId: attempt.attemptId });

            test.assert.strictEqual(result.signedIn, true);
            test.assert.strictEqual(exchanges, 1);
            test.assert.strictEqual(
              (yield* client['auth.publicAccount']({}))?.subject,
              'test-subject'
            );
          })
        )
      );
    } finally {
      await web.close();
      await server.close();
      await app.close();
    }

    const reopened = await resources.openApp({ path: database.path });

    try {
      const reopenedServer = await serve(reopened);

      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* makeStudyClient(StudyRpc, { baseUrl: reopenedServer.url });

              test.assert.strictEqual((yield* client['auth.status']({})).signedIn, true);
            })
          )
        );
      } finally {
        await reopenedServer.close();
      }
    } finally {
      await reopened.close();
    }
  }
);

test.stable(
  'eight live observers share one socket and leave unary RPC available',
  async ({ databases, resources }) => {
    const database = await databases();
    const app = await resources.openApp({ path: database.path });
    const server = await serve(app);
    let upgrades = 0;
    let closes = 0;
    let closed = Promise.withResolvers<void>();
    const proxy = studyRpcProxy(server.url);
    const configure = proxy['/rpc']!.configure;

    proxy['/rpc']!.configure = (instance, options) => {
      configure?.(instance, options);
      instance.on('close', () => {
        closes += 1;
        closed.resolve();
      });
      instance.on('proxyReqWs', () => {
        upgrades += 1;
      });
    };
    const web = await createServer({
      configFile: false,
      server: { host: '127.0.0.1', port: 0, hmr: false, proxy }
    });

    try {
      await web.listen();
      const address = web.httpServer?.address();

      test.assert.ok(address && typeof address !== 'string');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const forbiddenProtocol = RpcClient.layerProtocolSocket().pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(
          Socket.layerWebSocket(baseUrl.replace('http:', 'ws:') + '/rpc/live', {
            headers: { origin: 'https://evil.example' }
          })
        ),
        Layer.provide(Socket.layerWebSocketConstructorGlobal)
      );
      const forbidden = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcClient.make(StudyRpc).pipe(Effect.provide(forbiddenProtocol));

            return yield* Stream.runHead(client['settings.appSettings.live']({}));
          })
        ).pipe(Effect.timeout('2 seconds'))
      );

      test.assert.ok(Exit.isFailure(forbidden));
      upgrades = 0;
      closes = 0;
      closed = Promise.withResolvers<void>();
      const protocol = studySocketProtocol({ baseUrl });
      const memoMap = Layer.makeMemoMapUnsafe();

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const ready = yield* Effect.forEach(Array.from({ length: 8 }), () =>
              Deferred.make<void>()
            );

            const observers: Array<Fiber.Fiber<void, unknown>> = [];

            for (const signal of ready) {
              const observer = yield* Effect.gen(function* () {
                const scope = yield* Effect.scope;
                const services = yield* Layer.buildWithMemoMap(protocol, memoMap, scope);
                const client = yield* RpcClient.make(StudyRpc).pipe(Effect.provide(services));

                const markReady = (frame: { readonly _tag: string }) =>
                  frame._tag === 'Snapshot' ? Deferred.succeed(signal, undefined) : Effect.void;

                yield* client['settings.appSettings.live']({}).pipe(Stream.runForEach(markReady));
              }).pipe(Effect.forkScoped);

              observers.push(observer);
            }

            yield* Effect.forEach(ready, Deferred.await);
            const first = observers[0];

            test.assert.ok(first);
            yield* Fiber.interrupt(first);
            test.assert.strictEqual(closes, 0);
            const unary = yield* makeStudyClient(StudyRpc, { baseUrl });

            test.assert.strictEqual((yield* unary['settings.appSettings']({})).appearance, 2);
            test.assert.strictEqual(upgrades, 1);
          })
        ).pipe(Effect.timeout('10 seconds'))
      );
      await Effect.runPromise(
        Effect.tryPromise(() => closed.promise).pipe(Effect.timeout('5 seconds'))
      );
    } finally {
      await web.close();
      await server.close();
      await app.close();
    }
  }
);

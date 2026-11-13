import { StudyRpc } from '@study/contracts/rpc';
import { createTestDatabase } from '@study/db/testing';
import { makeStudyClient } from '@study/server/client';
import { App, serve } from '@study/server/runtime';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { createServer } from 'vite-plus';
import { assert } from 'vite-plus/test';

import { studyRpcProxy } from './rpc-proxy.ts';

testStable(
  'the browser dev proxy keeps appearance RPC connected across Vite restarts',
  async () => {
    const database = await createTestDatabase();
    const app = await App.open({ path: database.path });
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

                  assert.ok(address && typeof address !== 'string');

                  return `http://127.0.0.1:${address.port}`;
                }
              });
              const settings = yield* client['settings.appSettings']({});
              const themes = yield* client['themes.themes']({ limit: 100 });

              assert.strictEqual(settings.appearance, 2);
              assert.ok(themes.items.some((theme) => theme.id === 't3-code' && theme.builtin));
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
      await database.cleanup();
    }
  }
);

testStable(
  'browser OAuth completes through the forwarded web port and persists the account',
  async () => {
    const database = await createTestDatabase();
    let nonce = '';
    let callbackUrl = '';
    let exchanges = 0;
    const app = await App.open({
      path: database.path,
      fetch: async (_url, init) => {
        const form = new URLSearchParams(init?.body as string);

        assert.strictEqual(form.get('redirect_uri'), callbackUrl);
        assert.strictEqual(form.get('client_id'), 'issued-client');
        assert.ok(form.get('code_verifier'));
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

      assert.ok(address && typeof address !== 'string');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      callbackUrl = `${baseUrl}/auth/callback`;
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl });
            const attempt = yield* client['auth.startSignIn']({ callbackUrl });
            const authorization = new URL(attempt.url);

            assert.strictEqual(authorization.searchParams.get('redirect_uri'), callbackUrl);
            nonce = authorization.searchParams.get('nonce')!;
            const redirect = new URL(callbackUrl);

            redirect.searchParams.set('state', authorization.searchParams.get('state')!);
            redirect.searchParams.set('code', 'test-authorization');
            redirect.searchParams.set('client_id', 'issued-client');
            const wrongState = new URL(redirect);

            wrongState.searchParams.set('state', 'stale-state');
            const rejected = yield* Effect.promise(() => fetch(wrongState));

            assert.strictEqual(rejected.status, 400);
            yield* Effect.promise(() => rejected.arrayBuffer());
            const response = yield* Effect.promise(() => fetch(redirect));

            assert.strictEqual(response.status, 200);
            assert.strictEqual(response.headers.get('cache-control'), 'no-store');
            assert.strictEqual(response.headers.get('referrer-policy'), 'no-referrer');
            yield* Effect.promise(() => response.arrayBuffer());
            const replay = yield* Effect.promise(() => fetch(redirect));

            assert.strictEqual(replay.status, 400);
            yield* Effect.promise(() => replay.arrayBuffer());
            const result = yield* client['auth.finishSignIn']({ attemptId: attempt.attemptId });

            assert.strictEqual(result.signedIn, true);
            assert.strictEqual(exchanges, 1);
            assert.strictEqual((yield* client['auth.publicAccount']({}))?.subject, 'test-subject');
          })
        )
      );
    } finally {
      await web.close();
      await server.close();
      await app.close();
    }

    const reopened = await App.open({ path: database.path });

    try {
      const reopenedServer = await serve(reopened);

      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* makeStudyClient(StudyRpc, { baseUrl: reopenedServer.url });

              assert.strictEqual((yield* client['auth.status']({})).signedIn, true);
            })
          )
        );
      } finally {
        await reopenedServer.close();
      }
    } finally {
      await reopened.close();
      await database.cleanup();
    }
  }
);

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { StudyRpc } from '@study/contracts/rpc';
import { createTestDatabase } from '@study/db/testing';
import { makeStudyClient } from '@study/server/client';
import { App, serve } from '@study/server/runtime';
import { Effect } from 'effect';
import { createServer } from 'vite-plus';

import { studyRpcProxy } from './rpc-proxy.ts';

test('the browser dev proxy keeps appearance RPC connected across Vite restarts', async () => {
  const database = createTestDatabase();
  const app = await App.open({ path: database.path });
  const server = await serve(app);
  const web = await createServer({
    configFile: fileURLToPath(new URL('../../apps/web/vite.config.ts', import.meta.url)),
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

            assert.equal(settings.appearance, 2);
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
    database.cleanup();
  }
});

import { StudyRpc } from '@study/contracts/rpc';
import { Appearance, Language } from '@study/contracts/settings/types';
import { createTestDatabase } from '@study/db/testing';
import { makeStudyClient } from '@study/server/client';
import { App, serve } from '@study/server/runtime';
import { studyRpcProxy } from '@study/tooling/development/rpc-proxy';
import { Effect } from 'effect';
import { preview } from 'vite-plus';

import { creationResponse } from './creation-response.ts';
import { captureTimestampClock } from './profile.ts';

/** Each test owns a real application, database and preview; disposal follows acquisition order in reverse. */
export async function openWebStack() {
  await using resources = new AsyncDisposableStack();
  const database = await createTestDatabase();

  resources.defer(() => database.cleanup());
  const app = await App.open({
    path: await database.prepare(),
    timestampClock: captureTimestampClock()
  });

  resources.defer(() => app.close());
  const server = await serve(app);

  resources.defer(() => server.close());
  await app.workers.start();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
        const settings = yield* client['settings.appSettings']({});

        yield* client['settings.saveAppSettings']({
          ...settings,
          language: Language.ENGLISH,
          appearance: Appearance.DARK,
          zoomPercent: 125,
          onboarded: true
        });
      })
    )
  );
  const creation = creationResponse();
  const proxy = studyRpcProxy(server.url);

  proxy['/rpc'] = creation.proxy(proxy['/rpc']!);
  const web = await preview({
    configFile: Bun.fileURLToPath(new URL('../../../vite.config.ts', import.meta.url)),
    preview: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      proxy
    }
  });

  resources.defer(() => web.close());
  resources.defer(() => creation.close());
  const address = web.httpServer.address();

  if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port');

  const owner = resources.move();

  return {
    url: `http://127.0.0.1:${address.port}`,
    loseCreationResponse: creation.arm,
    [Symbol.asyncDispose]: () => owner.disposeAsync()
  };
}

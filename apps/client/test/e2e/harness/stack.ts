import { StudyRpc, Appearance, Language } from '@study/contracts';
import { makeStudyClient } from '@study/server/client';
import { createServerFixture } from '@study/server/testing';
import { testPolicy } from '@study/testing';
import { runTestEffect } from '@study/testing/effect';
import { createTestResources } from '@study/testing/resources';
import { studyRpcProxy } from '@study/tooling/development/rpc-proxy';
import { Effect } from 'effect';
import { preview } from 'vite-plus';

import { creationResponse } from './creation-response.ts';
import { captureTimestampClock } from './profile.ts';

/** Each test owns a real application, database and preview; disposal follows acquisition order in reverse. */
export async function openWebStack(
  options: Pick<
    NonNullable<Parameters<Awaited<ReturnType<typeof createServerFixture>>['openApp']>[0]>,
    'ai'
  > = {}
) {
  await using resources = createTestResources();
  const fixture = resources.manage(await createServerFixture());
  const { app, server } = await fixture.openRpc({
    timestampClock: captureTimestampClock(),
    ...options
  });

  await app.workers.start();
  await runTestEffect(
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
    }),
    { timeout: testPolicy.processStartupTimeout }
  );
  const creation = creationResponse();

  resources.manage(creation);
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

  resources.manage(web);
  const address = web.httpServer.address();

  if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port');

  const owner = resources.move();

  return {
    app,
    url: `http://127.0.0.1:${address.port}`,
    loseCreationResponse: creation.arm,
    [Symbol.asyncDispose]: owner.close
  };
}

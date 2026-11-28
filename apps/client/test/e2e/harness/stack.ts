import { StudyRpc, Appearance, Language, defaultAppearancePreferences } from '@study/contracts';
import { makeStudyClient } from '@study/server/client';
import { createChatGptReleasePeer, createServerFixture } from '@study/server/testing';
import { testPolicy } from '@study/testing';
import { runTestEffect } from '@study/testing/effect';
import { createTestResources } from '@study/testing/resources';
import { studyRpcProxy } from '@study/tooling/development/rpc-proxy';
import { Effect, Exit, Scope } from 'effect';
import { preview } from 'vite-plus';

import { creationResponse } from './creation-response.ts';
import { captureTimestampClock } from './profile.ts';

/** Each test owns a real application, database and preview; disposal follows acquisition order in reverse. */
export async function openWebStack(
  options: Pick<
    NonNullable<Parameters<Awaited<ReturnType<typeof createServerFixture>>['openApp']>[0]>,
    'ai' | 'voice' | 'modelUpdateNotices'
  > & {
    chatGptReleases?: Parameters<typeof createChatGptReleasePeer>[0];
    useDefaultNoteAppearance?: boolean;
  } = {}
) {
  const { ai, voice, chatGptReleases } = options;
  const chatGpt = chatGptReleases?.length ? createChatGptReleasePeer(chatGptReleases) : undefined;

  await using resources = createTestResources();
  const fixture = resources.manage(await createServerFixture());
  const { app, server } = await fixture.openRpc({
    timestampClock: captureTimestampClock(),
    modelUpdateNotices: options.modelUpdateNotices ?? false,
    ai,
    voice,
    fetch:
      chatGpt?.fetch ??
      ((...args) => {
        const request = new Request(...args);

        return request.url === 'https://models.dev/api.json'
          ? Promise.resolve(Response.json({}))
          : fetch(request);
      })
  });

  await app.workers.start();
  const scope = Scope.makeUnsafe();

  resources.defer(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const client = await Effect.runPromise(
    Scope.provide(makeStudyClient(StudyRpc, { baseUrl: server.url }), scope)
  );
  const rpc = {
    client,
    runPromise: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
      runTestEffect(Scope.provide(effect, scope), { timeout: testPolicy.processStartupTimeout })
  };

  await rpc.runPromise(
    Effect.gen(function* () {
      const settings = yield* client['settings.appSettings']({});

      yield* client['settings.saveAppSettings']({
        ...settings,
        language: Language.ENGLISH,
        appearance: Appearance.DARK,
        zoomPercent: 125,
        onboarded: true
      });

      if (!options.useDefaultNoteAppearance) {
        yield* client['settings.saveAppearancePreferences']({
          ...defaultAppearancePreferences,
          noteWidth: 'comfortable'
        });
      }
    })
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
    rpc,
    url: `http://127.0.0.1:${address.port}`,
    loseCreationResponse: creation.arm,
    selectChatGptRelease: (model: string) => {
      if (!chatGpt) throw new Error('No scripted ChatGPT releases configured');

      return chatGpt.select(app, model);
    },
    [Symbol.asyncDispose]: owner.close
  };
}

import { ServerContext, Database } from '@study/server';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';

import { Settings } from '#server/features/settings/index';

test.server.stable(
  'voice preferences default to silence filtering and survive reopening',
  async ({ databases, expect }) => {
    const location = await databases();
    const path = await location.prepare();

    async function run(save: boolean) {
      const context = await ServerContext.open(path);

      try {
        return await Effect.runPromise(
          Effect.gen(function* () {
            const settings = yield* Settings;

            if (save) {
              expect(yield* settings.voiceSettings()).toEqual({ filterSilence: true });
              yield* Effect.all(
                [
                  settings.saveVoiceSettings({ filterSilence: false }),
                  settings.saveVoiceSettings({ chunkSeconds: 10 }),
                  settings.saveVoiceSettings({ denoise: true })
                ],
                { concurrency: 'unbounded' }
              );
            }

            return yield* settings.voiceSettings();
          }).pipe(
            Effect.provide(
              Settings.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
            )
          )
        );
      } finally {
        context.close();
      }
    }

    const configured = { filterSilence: false, chunkSeconds: 10, denoise: true };

    expect(await run(true)).toEqual(configured);
    expect(await run(false)).toEqual(configured);
  }
);

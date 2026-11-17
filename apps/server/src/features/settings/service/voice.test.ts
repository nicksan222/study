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
              yield* settings.saveVoiceSettings({ filterSilence: false });
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

    expect(await run(true)).toEqual({ filterSilence: false });
    expect(await run(false)).toEqual({ filterSilence: false });
  }
);

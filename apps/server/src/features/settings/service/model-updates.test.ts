/** @file Checks durable, idempotent model update notifications with real SQLite. */
import { Database, ServerContext } from '@study/server';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';

import { Settings } from './index.ts';

const notice = {
  tier: 'medium',
  provider: 1,
  previousModel: 'gpt-6.1-sol',
  model: 'gpt-6.2-sol'
} as const;

test.server.stable(
  'catalog refresh leaves selections pinned and applies only the accepted current recommendation',
  async ({ databases, expect }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());
    const run = <A, E>(effect: Effect.Effect<A, E, typeof Settings.Identifier | Database>) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(
            Settings.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
          )
        )
      );
    const refresh = (model: string) =>
      Effect.gen(function* () {
        const settings = yield* Settings;

        yield* settings.refreshModelCatalog({ '1': [notice.previousModel, model] }, [
          { ...notice, model }
        ]);
      });

    try {
      await run(refresh(notice.model));
      await run(
        Effect.gen(function* () {
          const settings = yield* Settings;

          expect(yield* settings.model('medium')).toMatchObject({ modelId: notice.previousModel });
          expect(yield* settings.modelUpdates()).toEqual([notice]);
          yield* settings.updateModel(notice, false);
        })
      );
      context.close();
      context = new ServerContext(await location.open());

      await run(refresh(notice.model));
      await run(
        Effect.gen(function* () {
          const settings = yield* Settings;

          expect(yield* settings.modelUpdates()).toEqual([]);
          const latest = { ...notice, model: 'gpt-6.3-sol' };

          yield* refresh(latest.model);
          expect((yield* Effect.flip(settings.updateModel(notice, true))).kind).toBe(
            'invalid_input'
          );
          expect(yield* settings.modelUpdates()).toEqual([latest]);
          yield* settings.updateModel(latest, true);
          expect(yield* settings.model('medium')).toMatchObject({ modelId: latest.model });
          expect(yield* settings.modelUpdates()).toEqual([]);
        })
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

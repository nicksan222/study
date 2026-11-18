/** @file Checks durable, idempotent model update notifications with real SQLite. */
import { Database, ServerContext } from '@study/server';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';

import { Settings } from './index.ts';

const sol = (minor: number) => ({
  provider: 'chatgpt',
  family: 'sol',
  model: `gpt-6.${minor}-sol`,
  generation: 6,
  revision: minor
});

test.server.stable(
  'announces only newer releases and retains pending notices across reopen',
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

    try {
      await run(
        Effect.gen(function* () {
          const settings = yield* Settings;

          yield* settings.observeModelRelease(sol(1));
          expect(yield* settings.modelUpdates()).toEqual([]);
          const baseline = context.revisions().scopes.settings ?? 0n;

          yield* Effect.all(
            [settings.observeModelRelease(sol(2)), settings.observeModelRelease(sol(2))],
            {
              concurrency: 'unbounded'
            }
          );
          yield* settings.observeModelRelease(sol(1));
          expect(context.revisions().scopes.settings).toBe(baseline + 1n);
          expect(yield* settings.modelUpdates()).toEqual([
            {
              provider: 'chatgpt',
              family: 'sol',
              previousModel: 'gpt-6.1-sol',
              model: 'gpt-6.2-sol'
            }
          ]);
        })
      );
      context.close();
      context = new ServerContext(await location.open());

      await run(
        Effect.gen(function* () {
          const settings = yield* Settings;
          const [first] = yield* settings.modelUpdates();

          expect(first?.model).toBe('gpt-6.2-sol');
          yield* settings.observeModelRelease(sol(3));
          yield* settings.dismissModelUpdate(first!);
          const [latest] = yield* settings.modelUpdates();

          expect(latest?.previousModel).toBe('gpt-6.1-sol');
          expect(latest?.model).toBe('gpt-6.3-sol');
          yield* settings.dismissModelUpdate(latest!);
          yield* settings.observeModelRelease(sol(3));
          expect(yield* settings.modelUpdates()).toEqual([]);
        })
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

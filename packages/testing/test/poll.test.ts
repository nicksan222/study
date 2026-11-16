/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies bounded polling without repeating failed server observations.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers attempt limits, successful observations, failure propagation and interruption.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses native Effect scheduling without application services or database fixtures.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { test } from '@study/testing';
import { Deferred, Effect, Fiber } from 'effect';

const options = { attempts: 3, interval: 0, message: 'observation did not settle' };

test.unit.stable(
  'polling stops on the first ready observation and returns it',
  async ({ pollUntil, expect }) => {
    for (const target of [1, 3]) {
      let reads = 0;
      const result = await Effect.runPromise(
        pollUntil(
          Effect.sync(() => ++reads),
          (value) => value === target,
          options
        )
      );

      expect(result).toBe(target);
      expect(reads).toBe(target);
    }
  }
);

test.unit.stable('polling exhausts its exact observation budget', async ({ expect, pollUntil }) => {
  let reads = 0;
  let last = 0;

  await expect(
    Effect.runPromise(
      pollUntil(
        Effect.sync(() => ++reads),
        (value) => {
          last = value;

          return false;
        },
        options
      )
    )
  ).rejects.toThrow(options.message);
  expect(reads).toBe(3);
  expect(last).toBe(3);
});

test.unit.stable(
  'polling propagates typed failures without retrying them',
  async ({ pollUntil, expect }) => {
    let reads = 0;
    const failure = { reason: 'read failed' };
    const result = await Effect.runPromise(
      pollUntil(
        Effect.suspend(() => {
          reads++;

          return Effect.fail(failure);
        }),
        () => false,
        options
      ).pipe(Effect.result)
    );

    expect(result).toMatchObject({ failure });
    expect(reads).toBe(1);
  }
);

test.unit.stable(
  'interrupting polling stops further observations',
  async ({ pollUntil, expect }) => {
    let reads = 0;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const observed = yield* Deferred.make<void>();
          const fiber = yield* pollUntil(
            Effect.gen(function* () {
              reads++;
              yield* Deferred.succeed(observed, undefined);

              return false;
            }),
            (value) => value,
            { ...options, interval: '1 hour' }
          ).pipe(Effect.forkChild);

          yield* Deferred.await(observed);
          yield* Fiber.interrupt(fiber);
          expect(reads).toBe(1);
        })
      )
    );
  }
);

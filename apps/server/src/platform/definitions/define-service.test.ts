/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies defineService preserves operation types and typed failures while          │
 * │ normalizing thrown errors. Tests also cover lazy construction, dependency acquisition,   │
 * │ cancellation, and instrumentation behavior.                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: service acquires dependencies and runs operations; service preserves typed    │
 * │   failure identity and fields.                                                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/definitions/define-service directly with Vitest   ; no          │
 * │ application or database fixture is involved.                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { Cause, Context, Effect, Exit, Fiber, Layer } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { defineService } from '#server/platform/definitions/define-service';

class Greeting extends Context.Service<Greeting, string>()('test/Greeting') {}

testStable('service acquires dependencies and runs operations', async () => {
  const service = defineService(
    'test/Greeter',
    Effect.gen(function* () {
      const greeting = yield* Greeting;

      return { greet: (name: string) => Effect.succeed(`${greeting}, ${name}`) };
    })
  );
  const result = yieldService(service);

  async function yieldService(definition: typeof service) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const greeter = yield* definition;

        return yield* greeter.greet('Ada');
      }).pipe(
        Effect.provide(definition.layer.pipe(Layer.provide(Layer.succeed(Greeting, 'Hello'))))
      )
    );
  }

  assert.ok((await result) === 'Hello, Ada');
});

testStable('service preserves typed failure identity and fields', async () => {
  const failure = { _tag: 'Conflict' as const, revision: 42 };
  const service = defineService(
    'test/Failure',
    Effect.succeed({ fail: () => Effect.fail(failure) })
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const instance = yield* service;

      return yield* Effect.flip(instance.fail());
    }).pipe(Effect.provide(service.layer))
  );

  assert.strictEqual(result, failure);
  expect(result).toStrictEqual({ _tag: 'Conflict', revision: 42 });
});

testStable('service preserves a StudyError and its cause', async () => {
  const cause = new Error('underlying');
  const failure = new StudyError('transient', 'unavailable', { cause, retryAfterMs: 123 });
  const service = defineService(
    'test/StudyFailure',
    Effect.succeed({ fail: () => Effect.fail(failure) })
  );
  const result = await Effect.runPromise(
    Effect.flatMap(service, (instance) => Effect.flip(instance.fail())).pipe(
      Effect.provide(service.layer)
    )
  );

  assert.strictEqual(result, failure);
  assert.strictEqual(result.cause, cause);
  assert.strictEqual(result.retryAfterMs, 123);
});

testStable('service suspends and normalizes synchronous construction throws', async () => {
  const cause = new Error('private');
  const service = defineService(
    'test/Throw',
    Effect.succeed({
      fail: (): Effect.Effect<void> => {
        throw cause;
      }
    })
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const instance = yield* service;

      return yield* Effect.flip(instance.fail());
    }).pipe(Effect.provide(service.layer))
  );

  assert.strictEqual(result.cause, cause);
  assert.ok(result instanceof StudyError);
});

function serviceTypeAssertions() {
  const service = defineService(
    'test/Types',
    Effect.succeed({ greet: (name: string) => Effect.succeed(name.length) })
  );

  return Effect.gen(function* () {
    const instance = yield* service;
    const output: Effect.Effect<number, StudyError> = instance.greet('Ada');

    // @ts-expect-error method input is inferred
    instance.greet(1);

    return output;
  });
}

void serviceTypeAssertions;

testStable('service operations remain lazy and cancellable', async () => {
  let started = 0;
  let constructed = 0;
  let cancelled = 0;
  const service = defineService(
    'test/Cancel',
    Effect.succeed({
      wait: () => {
        constructed++;

        return Effect.sync(() => {
          started++;
        }).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              cancelled++;
            })
          )
        );
      }
    })
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      const instance = yield* service;
      const operation = instance.wait();

      assert.strictEqual(started, 0);
      assert.strictEqual(constructed, 0);
      const fiber = yield* Effect.forkChild(operation);

      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      const [exit] = yield* Fiber.awaitAll([fiber]);

      assert.ok(Exit.isFailure(exit));
      assert.ok(Cause.hasInterruptsOnly(exit.cause));
    }).pipe(Effect.provide(service.layer))
  );
  assert.strictEqual(started, 1);
  assert.strictEqual(constructed, 1);
  assert.strictEqual(cancelled, 1);
});

class Publication extends Context.Service<Publication, string>()('test/Publication') {}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

function errorAndLayerTypeAssertions() {
  const acquisitionFailure = { _tag: 'Acquisition' as const };
  const operationFailure = { _tag: 'Conflict' as const, revision: 42 };
  const service = defineService(
    'test/PreciseTypes',
    Effect.flatMap(Greeting, () =>
      Effect.succeed({
        publish: () => Effect.flatMap(Publication, () => Effect.fail(operationFailure))
      }).pipe(
        Effect.flatMap((operations) => Effect.fail(acquisitionFailure).pipe(Effect.as(operations)))
      )
    )
  );
  const operation = Effect.flatMap(service, (instance) => instance.publish()).pipe(
    Effect.provide(service.layer.pipe(Layer.provide(Layer.succeed(Greeting, 'hello'))))
  );

  type OperationError = Assert<
    Equal<
      Effect.Error<typeof operation>,
      typeof acquisitionFailure | typeof operationFailure | StudyError
    >
  >;

  type OperationServices = Assert<Equal<Effect.Services<typeof operation>, Publication>>;

  type AcquisitionError = Assert<
    Equal<Layer.Error<typeof service.layer>, typeof acquisitionFailure>
  >;

  type AcquisitionServices = Assert<Equal<Layer.Services<typeof service.layer>, Greeting>>;

  const assertions: [OperationError, OperationServices, AcquisitionError, AcquisitionServices] = [
    true,
    true,
    true,
    true
  ];

  return assertions;
}

void errorAndLayerTypeAssertions;

testStable('service methods retain their individual capability requirements', async () => {
  const guarded = defineService(
    'test/Guarded',
    Effect.succeed({ publish: () => Effect.map(Publication, (owner) => `published:${owner}`) })
  );
  const action = Effect.flatMap(guarded, (service) => service.publish()).pipe(
    Effect.provide(guarded.layer)
  );
  const typed: Effect.Effect<string, StudyError, Publication> = action;

  assert.ok(
    (await Effect.runPromise(typed.pipe(Effect.provideService(Publication, 'current')))) ===
      'published:current'
  );
});

function publicationTypeAssertions() {
  const guarded = defineService(
    'test/GuardedTypes',
    Effect.succeed({ publish: () => Effect.map(Publication, (owner) => owner.length) })
  );
  const action = Effect.flatMap(guarded, (service) => service.publish()).pipe(
    Effect.provide(guarded.layer)
  );

  // @ts-expect-error publication capability must be provided by the caller
  void Effect.runPromise(action);

  return action;
}

void publicationTypeAssertions;

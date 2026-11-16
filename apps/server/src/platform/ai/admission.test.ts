import type { StudyError } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies the AI concurrency gate’s capacity, interruption, release, and metric     │
 * │ behavior. These tests cover both direct use and reuse through an Effect layer.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts the concurrency cap, cancellation before dispatch, permit release, stream      │
 * │   cleanup, and active-work metrics.                                                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes makeAdmission directly with Effect fibers and streams; this unit test needs no   │
 * │ SQLite or provider fixture.                                                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import type { ConcurrencySettings } from '@study/contracts';
import { test } from '@study/testing';
import { Deferred, Effect, Fiber, Metric, Result } from 'effect';

import { AiWorkload, makeAdmission, withAdmissionSettings } from '#server/platform/ai/admission';

test.stable(
  'limits active work, interrupts queued work without dispatch, and releases on failure',
  async () => {
    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        const gate = makeAdmission({ concurrency: 2, maxWaiting: 1 });
        const release = yield* Deferred.make<void>();
        const started = yield* Deferred.make<void>();
        let active = 0;
        let dispatches = 0;
        const work = gate.run(
          Effect.gen(function* () {
            dispatches++;
            active++;

            if (active === 2) yield* Deferred.succeed(started, undefined);

            yield* Deferred.await(release);
          })
        );
        const first = yield* Effect.forkChild(work);
        const second = yield* Effect.forkChild(work);

        yield* Deferred.await(started);
        const waiting = yield* Effect.forkChild(work);

        yield* Effect.yieldNow;
        const overflow = yield* Effect.flip(gate.run(Effect.void));

        test.assert.ok(overflow.kind === 'rate_limited');
        yield* Fiber.interrupt(waiting);
        test.assert.strictEqual(dispatches, 2);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        yield* Effect.exit(gate.run(Effect.fail('failure')));
        test.assert.strictEqual(yield* gate.run(Effect.succeed('released')), 'released');

        return yield* Metric.snapshot;
      }).pipe(
        Effect.provideService(Metric.MetricRegistry, new Map()),
        Effect.provideService(Metric.CurrentMetricAttributes, { requestId: 'secret' })
      )
    );
    const admission = snapshots.find((value) => value.id === 'study.ai.admission');

    test.assert.ok(admission?.type === 'Counter');

    if (admission?.type === 'Counter') test.assert.strictEqual(admission.state.count, 4);

    const active = snapshots.find((value) => value.id === 'study.ai.active');

    test.assert.ok(active?.type === 'Gauge');

    if (active?.type === 'Gauge') test.assert.strictEqual(active.state.value, 0);

    test.expect(JSON.stringify(snapshots)).not.toMatch(/requestId|secret/);
  }
);

test.stable('rejects invalid capacity at construction', () => {
  for (const concurrency of [0, 9, 1.5, Infinity, NaN]) {
    test.assert.throws(() => makeAdmission({ concurrency }));
  }
});

test.stable(
  'holds a permit until a stream consumer ends and releases it on interruption',
  async () => {
    const { Queue, Stream } = await import('effect');

    function* verifyStreamPermit() {
      const gate = makeAdmission({ concurrency: 1, maxWaiting: 1 });
      const done = yield* Deferred.make<void>();
      const stream = Stream.callback<number, StudyError>((queue) =>
        gate.run(
          Effect.gen(function* () {
            yield* Queue.offer(queue, 1);
            yield* Effect.never;
          }).pipe(Effect.ensuring(Deferred.succeed(done, undefined)))
        )
      );

      yield* Stream.runDrain(Stream.take(stream, 1));
      yield* Deferred.await(done);
      test.assert.strictEqual(yield* gate.run(Effect.succeed('free')), 'free');
    }

    await Effect.runPromise(Effect.gen(verifyStreamPermit));
  }
);

test.stable(
  'layer reuse shares the owner across independent consumers and releases on defect',
  async () => {
    const { AiAdmission, admissionLayer } = await import('#server/platform/ai/admission');

    function* verifySharedAdmission() {
      const owner = makeAdmission({ concurrency: 1, maxWaiting: 0 });
      const layer = admissionLayer(owner);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const work = Effect.gen(function* () {
        const admission = yield* AiAdmission;

        return yield* admission.run(
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          })
        );
      }).pipe(Effect.provide(layer));
      const fiber = yield* Effect.forkChild(work);

      yield* Deferred.await(entered);
      const other = Effect.gen(function* () {
        const admission = yield* AiAdmission;

        return yield* admission.run(Effect.void);
      }).pipe(Effect.provide(layer));

      test.assert.ok((yield* Effect.flip(other)).kind === 'rate_limited');
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(fiber);
      yield* Effect.exit(owner.run(Effect.die('defect')));
      yield* other;
    }

    await Effect.runPromise(Effect.gen(verifySharedAdmission));
  }
);

test.stable('closing a scope interrupts active and waiting fibers', async () => {
  const { Exit, Scope } = await import('effect');

  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = makeAdmission({ concurrency: 1, maxWaiting: 1 });
      const scope = yield* Scope.make();
      const entered = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      let dispatched = 0;
      const work = gate.run(
        Effect.gen(function* () {
          dispatched++;
          yield* Deferred.succeed(entered, undefined);
          yield* Effect.never;
        }).pipe(Effect.ensuring(Deferred.succeed(stopped, undefined)))
      );

      yield* Scope.provide(Effect.forkScoped(work), scope);
      yield* Deferred.await(entered);
      yield* Scope.provide(Effect.forkScoped(work), scope);
      yield* Effect.yieldNow;
      yield* Scope.close(scope, Exit.void);
      yield* Deferred.await(stopped);
      test.assert.strictEqual(dispatched, 1);
      yield* gate.run(Effect.void);
    })
  );
});

test.stable(
  'resizing starts queued work when raised and preserves active work when lowered',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = makeAdmission({ concurrency: 1, maxWaiting: 2 });
        const releases = yield* Effect.all([
          Deferred.make<void>(),
          Deferred.make<void>(),
          Deferred.make<void>()
        ]);
        const entered = yield* Effect.all([
          Deferred.make<void>(),
          Deferred.make<void>(),
          Deferred.make<void>()
        ]);
        let dispatches = 0;
        const work = (index: number) =>
          gate.run(
            Effect.gen(function* () {
              dispatches++;
              yield* Deferred.succeed(entered[index]!, undefined);
              yield* Deferred.await(releases[index]!);
            })
          );
        const first = yield* Effect.forkChild(work(0));

        yield* Deferred.await(entered[0]!);
        const second = yield* Effect.forkChild(work(1));

        yield* Effect.yieldNow;
        test.assert.strictEqual(dispatches, 1);
        yield* gate.configure({ maxConcurrentAi: 2, maxQueuedAi: 1 });
        yield* Deferred.await(entered[1]!);
        const third = yield* Effect.forkChild(work(2));

        yield* Effect.yieldNow;
        yield* gate.configure({ maxConcurrentAi: 1, maxQueuedAi: 0 });
        test.assert.ok((yield* Effect.flip(gate.run(Effect.void))).kind === 'rate_limited');
        yield* Deferred.succeed(releases[0]!, undefined);
        yield* Fiber.join(first);
        yield* Effect.yieldNow;
        test.assert.strictEqual(dispatches, 2);
        yield* Deferred.succeed(releases[1]!, undefined);
        yield* Fiber.join(second);
        yield* Deferred.await(entered[2]!);
        test.assert.strictEqual(dispatches, 3);
        yield* Deferred.succeed(releases[2]!, undefined);
        yield* Fiber.join(third);
        test.assert.strictEqual(yield* gate.run(Effect.succeed('released')), 'released');
      })
    );
  }
);

test.stable(
  'refreshes persisted limits before new work using the same admission owner',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const owner = makeAdmission();
        let settings: ConcurrencySettings = { maxConcurrentAi: 1, maxQueuedAi: 0 };
        const gate = withAdmissionSettings(
          owner,
          Effect.sync(() => settings)
        );
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const first = yield* Effect.forkChild(
          gate.run(
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            })
          )
        );

        yield* Deferred.await(entered);
        test.assert.ok((yield* Effect.flip(gate.run(Effect.void))).kind === 'rate_limited');
        settings = { maxConcurrentAi: 2, maxQueuedAi: 0 };
        test.assert.strictEqual(yield* gate.run(Effect.succeed('new capacity')), 'new capacity');
        test.assert.ok(
          (yield* Effect.flip(owner.configure({ maxConcurrentAi: 0, maxQueuedAi: 0 }))).kind ===
            'invalid_input'
        );
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
      })
    );
  }
);

test.stable(
  'bulk saturation reserves admission for interactive work and releases interrupted capacity',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = makeAdmission({ concurrency: 1, maxWaiting: 1 });
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const bulk = yield* Effect.forkChild(
          gate
            .run(Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))))
            .pipe(Effect.provideService(AiWorkload, 'bulk'))
        );

        yield* Deferred.await(started);
        const rejected = yield* Effect.result(
          gate.run(Effect.void).pipe(Effect.provideService(AiWorkload, 'bulk'))
        );

        test.assert.isTrue(Result.isFailure(rejected));

        if (Result.isFailure(rejected)) test.expect(rejected.failure.kind).toBe('rate_limited');

        const interactive = yield* Effect.forkChild(gate.run(Effect.succeed('interactive')));

        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        test.expect(yield* Fiber.join(interactive)).toBe('interactive');
        yield* Fiber.join(bulk);
        test
          .expect(
            yield* gate
              .run(Effect.succeed('released'))
              .pipe(Effect.provideService(AiWorkload, 'bulk'))
          )
          .toBe('released');
      })
    );
  }
);

test.stable('interrupting admitted bulk work releases its capacity', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = makeAdmission({ concurrency: 1, maxWaiting: 0 });
      const entered = yield* Deferred.make<void>();
      const bulk = yield* Effect.forkChild(
        gate
          .run(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
          .pipe(Effect.provideService(AiWorkload, 'bulk'))
      );

      yield* Deferred.await(entered);
      yield* Fiber.interrupt(bulk);
      test
        .expect(
          yield* gate
            .run(Effect.succeed('released'))
            .pipe(Effect.provideService(AiWorkload, 'bulk'))
        )
        .toBe('released');
    })
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StudyError } from '@study/contracts/errors';
import { Deferred, Effect, Fiber, Metric } from 'effect';

import { makeAdmission } from '#server/platform/ai/admission';

test('limits active work, interrupts queued work without dispatch, and releases on failure', async () => {
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

      assert.equal(overflow.kind, 'rate_limited');
      yield* Fiber.interrupt(waiting);
      assert.equal(dispatches, 2);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      yield* Effect.exit(gate.run(Effect.fail('failure')));
      assert.equal(yield* gate.run(Effect.succeed('released')), 'released');

      return yield* Metric.snapshot;
    }).pipe(
      Effect.provideService(Metric.MetricRegistry, new Map()),
      Effect.provideService(Metric.CurrentMetricAttributes, { requestId: 'secret' })
    )
  );
  const admission = snapshots.find((value) => value.id === 'study.ai.admission');

  assert.equal(admission?.type, 'Counter');

  if (admission?.type === 'Counter') assert.equal(admission.state.count, 4);

  const active = snapshots.find((value) => value.id === 'study.ai.active');

  assert.equal(active?.type, 'Gauge');

  if (active?.type === 'Gauge') assert.equal(active.state.value, 0);

  assert.doesNotMatch(JSON.stringify(snapshots), /requestId|secret/);
});

test('rejects invalid capacity at construction', () => {
  for (const concurrency of [0, 9, 1.5, Infinity, NaN]) {
    assert.throws(() => makeAdmission({ concurrency }));
  }
});

test('holds a permit until a stream consumer ends and releases it on interruption', async () => {
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
    assert.equal(yield* gate.run(Effect.succeed('free')), 'free');
  }

  await Effect.runPromise(Effect.gen(verifyStreamPermit));
});

test('layer reuse shares the owner across independent consumers and releases on defect', async () => {
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

    assert.equal((yield* Effect.flip(other)).kind, 'rate_limited');
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(fiber);
    yield* Effect.exit(owner.run(Effect.die('defect')));
    yield* other;
  }

  await Effect.runPromise(Effect.gen(verifySharedAdmission));
});

test('closing a scope interrupts active and waiting fibers', async () => {
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
      assert.equal(dispatched, 1);
      yield* gate.run(Effect.void);
    })
  );
});

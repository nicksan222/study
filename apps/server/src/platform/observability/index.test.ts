import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies operation instrumentation filters log metadata and records completion,    │
 * │ duration, and active-work metrics. Tests ensure private values and ambient identifiers   │
 * │ do not leak into telemetry.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: only approved scalar operation metadata reaches the log sink; operation logs  │
 * │   inherit only allowed annotations and carry a span.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/observability/index directly with Vitest   ; no application or  │
 * │ database fixture is involved.                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import type { Tracer } from 'effect';

import { safeMetadata } from '#server/platform/observability/index';

function spanName(span: Tracer.AnySpan) {
  return span._tag === 'Span' ? span.name : 'external';
}

test.stable('only approved scalar operation metadata reaches the log sink', () => {
  test
    .expect(
      safeMetadata({
        requestId: 'r1',
        attempt: 2,
        prompt: 'secret',
        cause: new Error('secret'),
        entity: 'project',
        token: 'secret'
      })
    )
    .toStrictEqual({ requestId: 'r1', attempt: 2, entity: 'project' });
});

test.stable('operation logs inherit only allowed annotations and carry a span', async () => {
  const { Effect, Logger, References, Context, Tracer, Option } = await import('effect');
  const { observeOperation } = await import('#server/platform/observability/index');
  const entries: { message: unknown; annotations: unknown; spans: unknown }[] = [];
  const logger = Logger.make((entry) => {
    entries.push({
      message: entry.message,
      annotations: entry.fiber.getRef(References.CurrentLogAnnotations),
      spans: Option.map(Context.getOption(entry.fiber.context, Tracer.ParentSpan), (span) =>
        span._tag === 'Span'
          ? {
              name: span.name,
              parent: Option.map(span.parent, spanName)
            }
          : 'external'
      )
    });
  });

  await Effect.runPromise(
    observeOperation('test.operation', Effect.succeed('secret result')).pipe(
      Effect.annotateLogs({ requestId: 'r1', prompt: 'secret prompt' }),
      Effect.withSpan('parent'),
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(References.MinimumLogLevel, 'Debug')
    )
  );
  test.assert.strictEqual(entries.length, 2);
  const serialized = JSON.stringify(entries);

  test.expect(serialized).toMatch(/r1/);
  test.expect(serialized).toMatch(/test.operation/);
  test.expect(serialized).toMatch(/parent/);
  test.expect(serialized).not.toMatch(/secret/);
});

test.stable(
  'operation metrics record outcomes and release active operations without inheriting identifiers',
  async () => {
    const { Deferred, Effect, Fiber, Metric } = await import('effect');
    const { TestClock } = await import('effect/testing');
    const { observeOperation } = await import('#server/platform/observability/index');
    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const pending = yield* observeOperation(
          'secret-operation',
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
        ).pipe(Effect.forkChild);

        yield* Deferred.await(started);
        const during = yield* Metric.snapshot;

        yield* TestClock.adjust('2 seconds');
        yield* Fiber.interrupt(pending);
        yield* observeOperation('success', Effect.succeed('ok'));
        yield* Effect.flip(observeOperation('failure', Effect.fail('private failure')));

        return { during, after: yield* Metric.snapshot };
      }).pipe(
        Effect.provide(TestClock.layer()),
        Effect.provideService(Metric.MetricRegistry, new Map()),
        Effect.provideService(Metric.CurrentMetricAttributes, { requestId: 'private-id' })
      )
    );
    const active = snapshots.during.find((s) => s.id === 'study.operation.active');

    test.assert.ok(active?.type === 'Gauge');

    test.assert.ok(active?.type === 'Gauge');
    test.assert.strictEqual(active.state.value, 1);

    const after = snapshots.after;
    const gauge = after.find((s) => s.id === 'study.operation.active');

    test.assert.ok(gauge?.type === 'Gauge');

    test.assert.ok(gauge?.type === 'Gauge');
    test.assert.strictEqual(gauge.state.value, 0);

    const counts = after.filter((s) => s.id === 'study.operation.completed');

    test
      .expect(
        counts.map((s) => s.attributes?.outcome).sort((a, b) => (a ?? '').localeCompare(b ?? ''))
      )
      .toStrictEqual(['failure', 'interrupted', 'success']);

    for (const count of counts) {
      test.assert.ok(count.type === 'Counter');

      test.assert.ok(count.type === 'Counter');
      test.assert.strictEqual(count.state.count, 1);
    }

    const duration = after.find((s) => s.id === 'study.operation.duration_ms');

    test.assert.ok(duration?.type === 'Histogram');

    test.assert.ok(duration?.type === 'Histogram');
    test.assert.strictEqual(duration.state.count, 3);
    test.assert.ok(duration.state.sum >= 2000);

    test
      .expect(JSON.stringify(after))
      .not.toMatch(/private-id|secret-operation|private failure|requestId/);
  }
);

test.stable(
  'metric labels admit only canonical finite values and hooks ignore ambient attributes',
  async () => {
    const { Effect, Metric } = await import('effect');
    const {
      safeMetricLabels,
      recordAiAdmission,
      recordAiRetry,
      recordConfigurationWait,
      recordPublicationRejection
    } = await import('#server/platform/observability/index');

    test
      .expect(safeMetricLabels({ outcome: 'success', modelTier: 'smart', errorKind: 'transient' }))
      .toStrictEqual({
        outcome: 'success',
        modelTier: 'smart',
        errorKind: 'transient'
      });
    test
      .expect(safeMetricLabels({ outcome: 'private', requestId: 'secret' } as never))
      .toStrictEqual({});
    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        yield* recordAiAdmission();
        yield* recordAiRetry();
        yield* recordConfigurationWait();
        yield* recordPublicationRejection();

        return yield* Metric.snapshot;
      }).pipe(
        Effect.provideService(Metric.MetricRegistry, new Map()),
        Effect.provideService(Metric.CurrentMetricAttributes, { requestId: 'secret' })
      )
    );

    test.assert.strictEqual(snapshots.length, 4);

    for (const snapshot of snapshots) {
      test.assert.ok(snapshot.type === 'Counter');

      if (snapshot.type === 'Counter') test.assert.strictEqual(snapshot.state.count, 1);

      test.expect(JSON.stringify(snapshot.attributes ?? {})).not.toMatch(/secret|requestId/);
    }
  }
);

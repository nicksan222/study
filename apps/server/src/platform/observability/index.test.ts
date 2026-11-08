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

import { testStable } from '@study/testing/vitest';
import type { Tracer } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { safeMetadata } from '#server/platform/observability/index';

function spanName(span: Tracer.AnySpan) {
  return span._tag === 'Span' ? span.name : 'external';
}

testStable('only approved scalar operation metadata reaches the log sink', () => {
  expect(
    safeMetadata({
      requestId: 'r1',
      attempt: 2,
      prompt: 'secret',
      cause: new Error('secret'),
      entity: 'project',
      token: 'secret'
    })
  ).toStrictEqual({ requestId: 'r1', attempt: 2, entity: 'project' });
});

testStable('operation logs inherit only allowed annotations and carry a span', async () => {
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
  assert.strictEqual(entries.length, 2);
  const serialized = JSON.stringify(entries);

  expect(serialized).toMatch(/r1/);
  expect(serialized).toMatch(/test.operation/);
  expect(serialized).toMatch(/parent/);
  expect(serialized).not.toMatch(/secret/);
});

testStable(
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

    assert.ok(active?.type === 'Gauge');

    assert.ok(active?.type === 'Gauge');
    assert.strictEqual(active.state.value, 1);

    const after = snapshots.after;
    const gauge = after.find((s) => s.id === 'study.operation.active');

    assert.ok(gauge?.type === 'Gauge');

    assert.ok(gauge?.type === 'Gauge');
    assert.strictEqual(gauge.state.value, 0);

    const counts = after.filter((s) => s.id === 'study.operation.completed');

    expect(
      counts.map((s) => s.attributes?.outcome).sort((a, b) => (a ?? '').localeCompare(b ?? ''))
    ).toStrictEqual(['failure', 'interrupted', 'success']);

    for (const count of counts) {
      assert.ok(count.type === 'Counter');

      assert.ok(count.type === 'Counter');
      assert.strictEqual(count.state.count, 1);
    }

    const duration = after.find((s) => s.id === 'study.operation.duration_ms');

    assert.ok(duration?.type === 'Histogram');

    assert.ok(duration?.type === 'Histogram');
    assert.strictEqual(duration.state.count, 3);
    assert.ok(duration.state.sum >= 2000);

    expect(JSON.stringify(after)).not.toMatch(
      /private-id|secret-operation|private failure|requestId/
    );
  }
);

testStable(
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

    expect(
      safeMetricLabels({ outcome: 'success', modelTier: 'smart', errorKind: 'transient' })
    ).toStrictEqual({
      outcome: 'success',
      modelTier: 'smart',
      errorKind: 'transient'
    });
    expect(safeMetricLabels({ outcome: 'private', requestId: 'secret' } as never)).toStrictEqual(
      {}
    );
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

    assert.strictEqual(snapshots.length, 4);

    for (const snapshot of snapshots) {
      assert.ok(snapshot.type === 'Counter');

      if (snapshot.type === 'Counter') assert.strictEqual(snapshot.state.count, 1);

      expect(JSON.stringify(snapshot.attributes ?? {})).not.toMatch(/secret|requestId/);
    }
  }
);

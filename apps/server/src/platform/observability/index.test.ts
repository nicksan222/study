import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Tracer } from 'effect';

import { safeMetadata } from '#server/platform/observability/index';

function spanName(span: Tracer.AnySpan) {
  return span._tag === 'Span' ? span.name : 'external';
}

test('only approved scalar operation metadata reaches the log sink', () => {
  assert.deepEqual(
    safeMetadata({
      requestId: 'r1',
      attempt: 2,
      prompt: 'secret',
      cause: new Error('secret'),
      entity: 'project',
      token: 'secret'
    }),
    { requestId: 'r1', attempt: 2, entity: 'project' }
  );
});

test('operation logs inherit only allowed annotations and carry a span', async () => {
  const { Effect, Logger, References, Context, Tracer, Option } = await import('effect');
  const { observeOperation } = await import('#server/platform/observability/index');
  const entries: Array<{ message: unknown; annotations: unknown; spans: unknown }> = [];
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
  assert.equal(entries.length, 2);
  const serialized = JSON.stringify(entries);

  assert.match(serialized, /r1/);
  assert.match(serialized, /test.operation/);
  assert.match(serialized, /parent/);
  assert.doesNotMatch(serialized, /secret/);
});

test('operation metrics record outcomes and release active operations without inheriting identifiers', async () => {
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

  assert.equal(active?.type, 'Gauge');

  if (active?.type === 'Gauge') assert.equal(active.state.value, 1);

  const after = snapshots.after;
  const gauge = after.find((s) => s.id === 'study.operation.active');

  assert.equal(gauge?.type, 'Gauge');

  if (gauge?.type === 'Gauge') assert.equal(gauge.state.value, 0);

  const counts = after.filter((s) => s.id === 'study.operation.completed');

  assert.deepEqual(
    counts.map((s) => s.attributes?.outcome).sort((a, b) => (a ?? '').localeCompare(b ?? '')),
    ['failure', 'interrupted', 'success']
  );

  for (const count of counts) {
    assert.equal(count.type, 'Counter');

    if (count.type === 'Counter') assert.equal(count.state.count, 1);
  }

  const duration = after.find((s) => s.id === 'study.operation.duration_ms');

  assert.equal(duration?.type, 'Histogram');

  if (duration?.type === 'Histogram') {
    assert.equal(duration.state.count, 3);
    assert.ok(duration.state.sum >= 2000);
  }

  assert.doesNotMatch(
    JSON.stringify(after),
    /private-id|secret-operation|private failure|requestId/
  );
});

test('metric labels admit only canonical finite values and hooks ignore ambient attributes', async () => {
  const { Effect, Metric } = await import('effect');
  const {
    safeMetricLabels,
    recordAiAdmission,
    recordAiRetry,
    recordConfigurationWait,
    recordPublicationRejection
  } = await import('#server/platform/observability/index');

  assert.deepEqual(
    safeMetricLabels({ outcome: 'success', modelTier: 'smart', errorKind: 'transient' }),
    {
      outcome: 'success',
      modelTier: 'smart',
      errorKind: 'transient'
    }
  );
  assert.deepEqual(safeMetricLabels({ outcome: 'private', requestId: 'secret' } as never), {});
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

  assert.equal(snapshots.length, 4);

  for (const snapshot of snapshots) {
    assert.equal(snapshot.type, 'Counter');

    if (snapshot.type === 'Counter') assert.equal(snapshot.state.count, 1);

    assert.doesNotMatch(JSON.stringify(snapshot.attributes ?? {}), /secret|requestId/);
  }
});

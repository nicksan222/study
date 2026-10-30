import type { Context } from 'effect';
import { Clock, Effect, Exit, Metric, References } from 'effect';

import { elapsedMillis } from '#server/platform/time/index';

type MetricLabels = {
  readonly outcome?: 'success' | 'failure' | 'interrupted';
  readonly errorKind?:
    | 'auth'
    | 'cancelled'
    | 'config'
    | 'internal'
    | 'invalid_input'
    | 'model_unavailable'
    | 'not_enough'
    | 'not_found'
    | 'rate_limited'
    | 'transient'
    | 'unsupported';
  readonly modelTier?: 'tiny' | 'medium' | 'smart';
};

const metricLabelValues: Record<keyof MetricLabels, ReadonlySet<string>> = {
  outcome: new Set(['success', 'failure', 'interrupted']),
  errorKind: new Set([
    'auth',
    'cancelled',
    'config',
    'internal',
    'invalid_input',
    'model_unavailable',
    'not_enough',
    'not_found',
    'rate_limited',
    'transient',
    'unsupported'
  ]),
  modelTier: new Set(['tiny', 'medium', 'smart'])
};

/** Only finite, canonical dimensions are accepted, including at untyped boundaries. */
export function safeMetricLabels(labels: MetricLabels): Metric.Metric.AttributeSet {
  const result: Record<string, string> = {};

  for (const key of Object.keys(metricLabelValues) as Array<keyof MetricLabels>) {
    const value = labels[key];

    if (typeof value === 'string' && metricLabelValues[key].has(value)) result[key] = value;
  }

  return result;
}

const activeOperations = Metric.gauge('study.operation.active');

const operationDuration = Metric.histogram('study.operation.duration_ms', {
  boundaries: [1, 10, 100, 1000, 10000, 60000]
});

const outcomes = {
  success: Metric.counter('study.operation.completed', { attributes: { outcome: 'success' } }),
  failure: Metric.counter('study.operation.completed', { attributes: { outcome: 'failure' } }),
  interrupted: Metric.counter('study.operation.completed', {
    attributes: { outcome: 'interrupted' }
  })
};

const aiAdmission = Metric.counter('study.ai.admission');

const activeAi = Metric.gauge('study.ai.active');

const aiRetry = Metric.counter('study.ai.retry');

const configurationWait = Metric.counter('study.configuration.wait');

const publicationRejection = Metric.counter('study.publication.rejection');

// Isolate each update from ambient attributes and swallow instrumentation defects.
function recordMetric(effect: Effect.Effect<void>): Effect.Effect<void> {
  return effect.pipe(
    Effect.provideService(Metric.CurrentMetricAttributes, {}),
    Effect.catchCause(() =>
      Effect.logWarning('metric.update.failure').pipe(
        Effect.provideService(References.CurrentLogAnnotations, {})
      )
    )
  );
}

/** Call when an AI request is admitted. */
export const recordAiAdmission = () => recordMetric(Metric.update(aiAdmission, 1));

/** Track admitted work without inheriting request attributes. */
export function observeActiveAi<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.uninterruptibleMask((restore) =>
    recordAiAdmission().pipe(
      Effect.andThen(recordMetric(Metric.modify(activeAi, 1))),
      Effect.andThen(restore(effect)),
      Effect.ensuring(recordMetric(Metric.modify(activeAi, -1)))
    )
  );
}

/** Call when an AI attempt is retried. */
export const recordAiRetry = () => recordMetric(Metric.update(aiRetry, 1));

/** Call when work enters a configuration wait. */
export const recordConfigurationWait = () => recordMetric(Metric.update(configurationWait, 1));

/** Call when a publication is rejected by its ownership fence. */
export const recordPublicationRejection = (count = 1) =>
  recordMetric(Metric.update(publicationRejection, count));

const allowed = new Set([
  'operation',
  'requestId',
  'executionId',
  'activity',
  'attempt',
  'entity',
  'entityId',
  'causationId',
  'durationMs',
  'errorKind'
]);

/** Keep untrusted payloads, provider responses and causes out of log metadata. */
export function safeMetadata(
  metadata: Readonly<Record<string, unknown>>
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (
      allowed.has(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    )
      result[key] = value;
  }

  return result;
}

/** Annotations inherit through child fibers and spans. */
export function annotateOperation<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  metadata: Readonly<Record<string, unknown>>
): Effect.Effect<A, E, R> {
  return effect.pipe(Effect.annotateLogs(safeMetadata(metadata)));
}

/** Instrument a lazy operation without exposing its input, result, or failure. */
export function observeOperation<A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> {
  function* runObservedOperation(
    restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  ) {
    const inherited = yield* References.CurrentLogAnnotations;
    const annotations = { ...safeMetadata(inherited), operation: name };
    const clock = yield* Clock.Clock;
    const started = clock.monotonicTimeNanosUnsafe();
    const log = (message: string, duration?: number) =>
      Effect.logDebug(message).pipe(
        Effect.provideService(References.CurrentLogAnnotations, {
          ...annotations,
          ...(duration === undefined ? {} : { durationMs: duration })
        })
      );

    yield* recordMetric(Metric.modify(activeOperations, 1));

    return yield* log('operation.start').pipe(
      Effect.andThen(restore(effect)),
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const duration = elapsedMillis(clock, started);
          const outcome = Exit.isSuccess(exit)
            ? 'success'
            : Exit.hasInterrupts(exit)
              ? 'interrupted'
              : 'failure';

          yield* recordMetric(Metric.modify(activeOperations, -1));
          yield* recordMetric(Metric.update(operationDuration, duration));
          yield* recordMetric(Metric.update(outcomes[outcome], 1));
          yield* log(Exit.isSuccess(exit) ? 'operation.finish' : 'operation.failure', duration);
        })
      )
    );
  }

  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(() => runObservedOperation(restore))
  ).pipe(Effect.withSpan(name));
}

/** Run a synchronous database step in the current operation's tracing context. */
export function observeSyncOperation<A>(
  context: Context.Context<never>,
  name: string,
  run: () => A
): A {
  let thrown: unknown;
  let failed = false;

  try {
    return Effect.runSyncWith(context)(
      observeOperation(
        name,
        Effect.try({
          try: run,
          catch: (error) => {
            failed = true;
            thrown = error;

            return error;
          }
        })
      )
    );
  } catch (error) {
    if (failed) throw thrown;

    throw error;
  }
}

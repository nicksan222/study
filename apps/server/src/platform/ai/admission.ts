/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the shared AI admission service and bounded concurrency gate. The owner    │
 * │ limits active and waiting work while releasing permits across failure, cancellation, and │
 * │ stream completion.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports Admission, AiAdmission, makeAdmission, admissionLayer. makeAdmission applies a │
 * │   hard concurrency limit and a separate bounded waiting capacity; callers reuse the      │
 * │   Admission owner across runtime scopes.                                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ nativeLayers creates one Admission for the App; admissionLayer exposes that same owner   │
 * │ to service and worker layers.                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { ConcurrencySettings } from '@study/contracts/settings/types';
import { Context, Effect, Layer, Option, Semaphore } from 'effect';

import { observeActiveAi } from '#server/platform/observability/index';

export const AiWorkload = Context.Reference<'interactive' | 'bulk'>('study/AiWorkload', {
  defaultValue: () => 'interactive'
});

export interface Admission {
  readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | StudyError, R>;
}

interface ConfigurableAdmission extends Admission {
  readonly configure: (settings: ConcurrencySettings) => Effect.Effect<void, StudyError>;
}

export class AiAdmission extends Context.Service<AiAdmission, ConfigurableAdmission>()(
  'study/AiAdmission'
) {}

/** Construct once per application, and reuse across runtime and worker restarts. */
export function makeAdmission(
  options: { concurrency?: number; maxWaiting?: number } = {}
): ConfigurableAdmission {
  const concurrency = options.concurrency ?? 2;
  const maxWaiting = options.maxWaiting ?? 16;

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new RangeError('AI concurrency must be between 1 and 8');

  if (!Number.isInteger(maxWaiting) || maxWaiting < 0 || maxWaiting > 64)
    throw new RangeError('AI waiting capacity must be between 0 and 64');

  // Only this semaphore owns scarce provider execution capacity.
  const permits = Semaphore.makeUnsafe(concurrency);
  // Admission permits bound queued ownership; acquiring them never waits.
  const capacity = Semaphore.makeUnsafe(concurrency + maxWaiting);
  const bulkCapacity = Semaphore.makeUnsafe(Math.max(1, concurrency + maxWaiting - 1));

  const configuration = Semaphore.makeUnsafe(1);
  let currentConcurrency = concurrency;
  let currentWaiting = maxWaiting;

  return {
    configure: (settings) =>
      configuration.withPermit(
        Effect.gen(function* () {
          const { maxConcurrentAi, maxQueuedAi } = settings;

          if (
            !Number.isInteger(maxConcurrentAi) ||
            maxConcurrentAi < 1 ||
            maxConcurrentAi > 8 ||
            !Number.isInteger(maxQueuedAi) ||
            maxQueuedAi < 0 ||
            maxQueuedAi > 64
          )
            return yield* Effect.fail(new StudyError('invalid_input', 'Invalid AI capacity'));

          if (maxConcurrentAi === currentConcurrency && maxQueuedAi === currentWaiting) return;

          // Resize the existing owners so active requests and queued cancellation stay intact.
          yield* capacity.resize(maxConcurrentAi + maxQueuedAi);
          yield* bulkCapacity.resize(Math.max(1, maxConcurrentAi + maxQueuedAi - 1));
          yield* permits.resize(maxConcurrentAi);
          currentConcurrency = maxConcurrentAi;
          currentWaiting = maxQueuedAi;
        }).pipe(Effect.uninterruptible)
      ),
    run: (effect) =>
      Effect.gen(function* () {
        const workload = yield* AiWorkload;
        const admitted = capacity
          .withPermitsIfAvailable(1)(permits.withPermit(observeActiveAi(effect)))
          .pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new StudyError('rate_limited', 'AI capacity is full')),
                onSome: Effect.succeed
              })
            )
          );

        if (workload === 'interactive') return yield* admitted;

        return yield* bulkCapacity
          .withPermitsIfAvailable(1)(admitted)
          .pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(new StudyError('rate_limited', 'Bulk AI capacity is full')),
                onSome: Effect.succeed
              })
            )
          );
      })
  };
}

/** The layer captures an existing owner, not a new gate per layer build. */
export const admissionLayer = (admission: ConfigurableAdmission) =>
  Layer.succeed(AiAdmission, admission);

/** Refresh persisted capacity before admission without replacing the shared gate. */
export const withAdmissionSettings = (
  admission: ConfigurableAdmission,
  settings: Effect.Effect<ConcurrencySettings, StudyError>
): Admission => ({
  run: (effect) =>
    settings.pipe(Effect.flatMap(admission.configure), Effect.andThen(admission.run(effect)))
});

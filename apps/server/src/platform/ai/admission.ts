import { StudyError } from '@study/contracts/errors';
import { Context, Effect, Layer, Option, Semaphore } from 'effect';

import { observeActiveAi } from '#server/platform/observability/index';

export interface Admission {
  readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | StudyError, R>;
}

export class AiAdmission extends Context.Service<AiAdmission, Admission>()('study/AiAdmission') {}

/** Construct once per application, and reuse across runtime and worker restarts. */
export function makeAdmission(
  options: { concurrency?: number; maxWaiting?: number } = {}
): Admission {
  const concurrency = options.concurrency ?? 2;
  const maxWaiting = options.maxWaiting ?? 16;

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new RangeError('AI concurrency must be between 1 and 8');

  if (!Number.isInteger(maxWaiting) || maxWaiting < 0 || maxWaiting > 64)
    throw new RangeError('AI waiting capacity must be between 0 and 64');

  const permits = Semaphore.makeUnsafe(concurrency);
  const capacity = Semaphore.makeUnsafe(concurrency + maxWaiting);

  return {
    run: (effect) =>
      capacity
        .withPermitsIfAvailable(1)(permits.withPermit(observeActiveAi(effect)))
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new StudyError('rate_limited', 'AI capacity is full')),
              onSome: Effect.succeed
            })
          )
        )
  };
}

/** The layer captures an existing owner, not a new gate per layer build. */
export const admissionLayer = (admission: Admission) => Layer.succeed(AiAdmission, admission);

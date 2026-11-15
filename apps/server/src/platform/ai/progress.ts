/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coalesces preview text while preserving observation ordering and write failures.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Batches text updates and flushes before tool and terminal observations.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The agent harness owns the timer; the observer owns guarded SQLite persistence.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { agentObservationSchema } from '@study/contracts';
import type { StudyError } from '@study/contracts';
import { Deferred, Effect, Queue, Semaphore } from 'effect';

type Event = (typeof agentObservationSchema.Type)['event'];

/** One buffer per agent run; the caller owns the periodic flush fiber's lifetime. */
export function batchAgentProgress(write: (event: Event) => Effect.Effect<void, StudyError>) {
  const lock = Semaphore.makeUnsafe(1);
  let pending = '';
  let first = true;
  const flush = Effect.gen(function* () {
    if (!pending) return;

    const text = pending;

    pending = '';
    yield* write({ type: 'text-delta', text });
    first = false;
  });

  return {
    flush: lock.withPermit(flush),
    observe: (event: Event) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (event.type === 'text-delta') {
            pending += event.text;

            // Show the first text immediately and bound buffering between timed flushes.
            if (first || pending.length >= 4096) yield* flush;

            return;
          }

          yield* flush;
          yield* write(event);
        })
      )
  };
}

/** Persist observations in a sibling scope, outside the provider permit owner. */
export const scopedAgentProgress = (write: (event: Event) => Effect.Effect<void, StudyError>) =>
  Effect.gen(function* () {
    type Request = {
      operation: Effect.Effect<void, StudyError>;
      accepted: Deferred.Deferred<void, StudyError>;
    };

    const queue = yield* Queue.bounded<Request>(1);

    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    yield* Effect.forever(
      Effect.gen(function* () {
        const request = yield* Queue.take(queue);
        const result = yield* Effect.exit(request.operation);

        yield* Deferred.done(request.accepted, result);
      })
    ).pipe(Effect.forkScoped);

    const outsideProvider = (operation: Effect.Effect<void, StudyError>) =>
      Effect.gen(function* () {
        const accepted = yield* Deferred.make<void, StudyError>();

        yield* Queue.offer(queue, { operation, accepted });
        yield* Deferred.await(accepted);
      });

    return {
      ...batchAgentProgress((event) => outsideProvider(write(event))),
      preflight: outsideProvider
    };
  });

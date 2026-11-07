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

import type { agentObservationSchema } from '@study/contracts/ai/progress';
import type { StudyError } from '@study/contracts/errors';
import { Effect, Semaphore } from 'effect';

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

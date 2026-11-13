import { Effect } from 'effect';
import type { Duration } from 'effect';

import { runRequest } from '../effect/runtime';
import { toStudyError } from './errors';

/** Runs serialized periodic transport work until its owner releases it. */
export function repeatRequest(action: () => Promise<void>, interval: Duration.Input): () => void {
  const controller = new AbortController();
  const operation = Effect.sleep(interval).pipe(
    Effect.andThen(Effect.tryPromise({ try: action, catch: toStudyError })),
    Effect.forever
  );

  void runRequest(operation, controller.signal).catch(() => undefined);

  return () => controller.abort();
}

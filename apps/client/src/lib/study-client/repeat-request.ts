import { Effect } from 'effect';
import type { Duration } from 'effect';

import { runRequest } from '../effect/runtime';
import { toStudyError } from './errors';

/** Runs serialized periodic transport work until its owner releases it. */
export function repeatRequest(action: () => Promise<void>, interval: Duration.Input): () => void {
  return runScheduled(delayed(action, interval).pipe(Effect.forever));
}

/** Runs one operation after a delay and lets its owner cancel before it starts. */
export function scheduleRequest(action: () => Promise<void>, delay: Duration.Input): () => void {
  return runScheduled(delayed(action, delay));
}

function delayed(action: () => Promise<void>, delay: Duration.Input) {
  return Effect.sleep(delay).pipe(
    Effect.andThen(Effect.tryPromise({ try: action, catch: toStudyError }))
  );
}

function runScheduled(operation: ReturnType<typeof delayed>) {
  const controller = new AbortController();

  void runRequest(operation, controller.signal).catch(() => undefined);

  return () => controller.abort();
}

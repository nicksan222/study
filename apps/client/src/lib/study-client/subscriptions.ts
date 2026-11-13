import { isRetryable } from '@study/contracts/errors';
import { Effect, Schedule, Stream } from 'effect';

import { runRequest } from '../effect/runtime';
import { studyClient } from './client';
import type { StudyClient } from './client';
import { observeConnectionError } from './connection';
import { toStudyError } from './errors';

/** Reconnect with a fresh scoped RPC stream; abort releases the viewer, not durable work. */
export function subscribe<A, E>(
  invoke: (client: StudyClient) => Stream.Stream<A, E>,
  onValue: (value: A) => void,
  signal: AbortSignal
) {
  return runRequest(
    Effect.scoped(
      Effect.flatMap(studyClient, (client) =>
        Stream.runForEach(invoke(client), (value) =>
          Effect.sync(() => {
            if (!signal.aborted) onValue(value);
          })
        )
      )
    ).pipe(
      Effect.tapError((error) => Effect.sync(() => observeConnectionError(error))),
      Effect.mapError(toStudyError),
      Effect.retry({
        schedule: Schedule.spaced('1 second'),
        times: 5,
        while: (error) => isRetryable(error.kind)
      })
    ),
    signal
  );
}

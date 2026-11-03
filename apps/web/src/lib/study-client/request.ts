import { Effect } from 'effect';

import { runRequest } from '../effect/runtime';
import { studyClient } from './client';
import type { StudyClient } from './client';
import { toStudyError } from './errors';

/** Runs a scoped native RPC request with cancellation and canonical application errors. */
export function request<A, E>(
  invoke: (client: StudyClient) => Effect.Effect<A, E>,
  signal?: AbortSignal
) {
  return runRequest(
    Effect.scoped(Effect.flatMap(studyClient, invoke)).pipe(Effect.mapError(toStudyError)),
    signal
  );
}

export type { StudyClient } from './client';

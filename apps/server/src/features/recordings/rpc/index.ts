import type { StudyError } from '@study/contracts/errors';
import { RecordingsRpc } from '@study/contracts/recordings/rpc';
import { Effect } from 'effect';

import { Recordings } from '#server/features/recordings/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const RecordingsRpcLive = RecordingsRpc.toLayer(
  Effect.gen(function* () {
    const recordings = yield* Recordings;

    return {
      'recordings.createRecording': ({ id }) =>
        recordings.createRecording(id).pipe(Effect.mapError(failure)),
      'recordings.appendRecording': (input) =>
        recordings.appendRecording(input).pipe(Effect.mapError(failure)),
      'recordings.recording': ({ id }) => recordings.recording(id).pipe(Effect.mapError(failure)),
      'recordings.recordings': (input) =>
        recordings.recordings(input).pipe(Effect.mapError(failure)),
      'recordings.deleteRecording': ({ id }) =>
        recordings.deleteRecording(id).pipe(Effect.mapError(failure)),
      'recordings.postRecording': (input) =>
        recordings.postRecording(input).pipe(Effect.mapError(failure)),
      'recordings.recordingPost': (input) =>
        recordings.recordingPost(input).pipe(Effect.mapError(failure))
    };
  })
);

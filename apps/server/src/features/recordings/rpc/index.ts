/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps the recording RPC contract to recording service operations.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - RPC handlers adapt declared schemas to the owning feature service; transport wiring    │
 * │   stays here.                                                                            │
 * │ - Maps declared operations to the feature service.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Leaves input validation and domain behavior to contracts and service.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { RecordingsRpc } from '@study/contracts/recordings/rpc';
import { Effect } from 'effect';

import { Recordings } from '#server/features/recordings/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const RecordingsRpcLive = defineRpc(
  RecordingsRpc,
  Effect.gen(function* () {
    const recordings = yield* Recordings;

    return {
      'recordings.createRecording': ({ id }) => recordings.createRecording(id),
      'recordings.appendRecording': (input) => recordings.appendRecording(input),
      'recordings.recording': ({ id }) => recordings.recording(id),
      'recordings.recordings': (input) => recordings.recordings(input),
      'recordings.deleteRecording': ({ id }) => recordings.deleteRecording(id),
      'recordings.postRecording': (input) => recordings.postRecording(input),
      'recordings.recordingPost': (input) => recordings.recordingPost(input)
    };
  })
);

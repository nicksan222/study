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

import { Recordings } from '#server/features/recordings/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const RecordingsRpcLive = defineRpc(
  RecordingsRpc,
  { recordings: Recordings },
  ({ recordings }) => ({
    'recordings.createRecording': ({ id }) => recordings.createRecording(id),
    'recordings.appendRecording': recordings.appendRecording,
    'recordings.recording': ({ id }) => recordings.recording(id),
    'recordings.recordings': recordings.recordings,
    'recordings.deleteRecording': ({ id }) => recordings.deleteRecording(id),
    'recordings.postRecording': recordings.postRecording,
    'recordings.recordingPost': recordings.recordingPost
  })
);

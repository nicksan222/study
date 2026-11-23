/** @file Owns recordings within this feature. */

import type {
  NoteId,
  RecordingId,
  appendRecordingInputSchema,
  postRecordingInputSchema,
  recordingPageInputSchema
} from '@study/contracts';
import { publicationTransaction, transaction, useStore, pageById } from '@study/server';

import {
  RecordingPostSnapshotStore,
  RecordingPostStore,
  RecordingStore
} from '#server/features/recordings/store/index';
import type { finishRecordingPostInputSchema } from '#server/features/recordings/store/schemas';

export function* recordingOperations() {
  const recordings = yield* useStore(RecordingStore);

  const posts = yield* useStore(RecordingPostStore);

  const snapshots = yield* useStore(RecordingPostSnapshotStore);

  return {
    recording: recordings.recording,
    recordingPost: posts.recordingPost,
    recordingPostSnapshot: snapshots.recordingPostSnapshot,
    recordings: (input: typeof recordingPageInputSchema.Type) =>
      pageById(recordings.recordings, input),
    createRecording: (id: NoteId) =>
      transaction((tx) => tx.store(RecordingStore).createRecording(id)),
    appendRecording: (input: typeof appendRecordingInputSchema.Type) =>
      transaction((tx) => tx.store(RecordingStore).appendRecording(input)),
    deleteRecording: (id: RecordingId) =>
      transaction((tx) => tx.store(RecordingStore).deleteRecording(id)),
    postRecording: (input: typeof postRecordingInputSchema.Type) =>
      transaction((tx) => {
        const requestId = crypto.randomUUID();
        const post = tx.store(RecordingPostStore).captureRecordingPost({ ...input, requestId });

        if (post.requestId === requestId) {
          const snapshot = tx
            .store(RecordingPostSnapshotStore)
            .recordingPostSnapshot({ requestId });

          tx.emit({
            type: 'RecordingPostRequested',
            eventId: requestId,
            requestId,
            recordingId: snapshot.recordingId,
            noteId: snapshot.noteId,
            projectId: snapshot.projectId,
            causationId: null,
            correlationId: requestId,
            inputVersion: 1,
            depth: 0
          });
        }

        return post;
      }),
    finishRecordingPost: (input: typeof finishRecordingPostInputSchema.Type) =>
      publicationTransaction((tx) => {
        tx.store(RecordingPostSnapshotStore).recordingPostSnapshot({
          requestId: input.requestId
        });

        return tx.store(RecordingPostStore).finishRecordingPost(input);
      })
  };
}

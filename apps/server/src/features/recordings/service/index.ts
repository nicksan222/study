/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates recording, post, and snapshot stores, wrapping writes in transactions  │
 * │ and exposing paged recording operations.                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature services own application rules and coordinate typed store operations.          │
 * │ - Validates or coordinates feature-level operations.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses owned stores and platform transactions rather than querying SQLite directly.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { RecordingId, NoteId } from '@study/contracts/ids';
import type { copyNoteContentSchema } from '@study/contracts/notes/notes';
import type {
  postRecordingInputSchema,
  appendRecordingInputSchema,
  recordingPageInputSchema
} from '@study/contracts/recordings/rpc';
import { Effect } from 'effect';

import { RecordingCopyStore } from '#server/features/recordings/store/copy';
import {
  RecordingStore,
  RecordingPostStore,
  RecordingPostSnapshotStore
} from '#server/features/recordings/store/index';
import type { finishRecordingPostInputSchema } from '#server/features/recordings/store/schemas';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';
import { pageById } from '#server/platform/definitions/page-by-id';

export const Recordings = defineService(
  'study/Recordings',
  Effect.gen(function* () {
    const recordings = yield* useStore(RecordingStore);
    const posts = yield* useStore(RecordingPostStore);
    const snapshots = yield* useStore(RecordingPostSnapshotStore);

    return {
      recording: recordings.recording,
      findRecording: recordings.findRecording,
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
          const requestId = randomUUID();
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
  }),
  {
    copyNotesInTransaction: (tx: Transaction, input: typeof copyNoteContentSchema.Type) =>
      tx.store(RecordingCopyStore).copy(input)
  }
);

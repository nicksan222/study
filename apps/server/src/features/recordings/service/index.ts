import { randomUUID } from 'node:crypto';

import type { RecordingId, SessionId } from '@study/contracts/ids';
import type {
  postRecordingInputSchema,
  appendRecordingInputSchema,
  recordingPageInputSchema
} from '@study/contracts/recordings/rpc';
import { Effect } from 'effect';

import {
  RecordingStore,
  RecordingPostStore,
  RecordingPostSnapshotStore
} from '#server/features/recordings/store/index';
import type { finishRecordingPostInputSchema } from '#server/features/recordings/store/schemas';
import { defineService } from '#server/platform/definitions/define-service';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';

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
        Effect.gen(function* () {
          const items = yield* recordings.recordings(input);
          const last = items.at(-1);
          const more =
            last && items.length === input.limit
              ? yield* recordings.recordings({ limit: 1, before: last.id })
              : [];

          return { items, next: more.length && last ? last.id : null };
        }),
      createRecording: (id: SessionId) =>
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
              sessionId: snapshot.sessionId,
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
  })
);

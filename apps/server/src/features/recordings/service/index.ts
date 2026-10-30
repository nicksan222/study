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
import { Database } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction } from '#server/platform/definitions/define-store';
import { emitEvent } from '#server/platform/workflows/events';
import { PublicationGuard } from '#server/platform/workflows/publication';

export const Recordings = defineService(
  'study/Recordings',
  Effect.gen(function* () {
    const { store: context } = yield* Database;
    const recordings = RecordingStore.make(context);
    const posts = RecordingPostStore.make(context);
    const snapshots = RecordingPostSnapshotStore.make(context);

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
        transaction(context, (tx) => tx.store(RecordingStore).createRecording(id)),
      appendRecording: (input: typeof appendRecordingInputSchema.Type) =>
        transaction(context, (tx) => tx.store(RecordingStore).appendRecording(input)),
      deleteRecording: (id: RecordingId) =>
        transaction(context, (tx) => tx.store(RecordingStore).deleteRecording(id)),
      postRecording: (input: typeof postRecordingInputSchema.Type) =>
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const post = tx.store(RecordingPostStore).captureRecordingPost({ ...input, requestId });

          if (post.requestId === requestId) {
            const snapshot = tx
              .store(RecordingPostSnapshotStore)
              .recordingPostSnapshot({ requestId });

            emitEvent(
              context,
              {
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
              },
              context.clock.currentTimeMillisUnsafe()
            );
          }

          return post;
        }),
      finishRecordingPost: (input: typeof finishRecordingPostInputSchema.Type) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();
            tx.store(RecordingPostSnapshotStore).recordingPostSnapshot({
              requestId: input.requestId
            });

            return tx.store(RecordingPostStore).finishRecordingPost(input);
          });
        })
    };
  })
);

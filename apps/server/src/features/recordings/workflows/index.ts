import { failureSchema, StudyError } from '@study/contracts/errors';
import { recordingPostRequestedSchema } from '@study/contracts/events';
import { messageIdSchema, sourceIdSchema } from '@study/contracts/ids';
import { recordingPostSchema } from '@study/contracts/recordings/schemas';
import type { sourceSchema } from '@study/contracts/sources/schemas';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Recordings } from '#server/features/recordings/service/index';
import { Sources } from '#server/features/sources/index';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import type { Trigger } from '#server/platform/workflows/triggers';

export const recordingPostWorkflow = defineWorkflow({
  name: 'recording-post',
  version: 1,
  payload: Schema.Struct({ event: recordingPostRequestedSchema }),
  success: recordingPostSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const recordingPostHandler = ({ event }: typeof recordingPostWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const recordings = yield* Recordings;
    const sources = yield* Sources;
    const conversations = yield* Conversations;
    const { store } = yield* Database;
    const snapshot = yield* recordings.recordingPostSnapshot({ requestId: event.requestId });

    if (
      snapshot.recordingId !== event.recordingId ||
      snapshot.sessionId !== event.sessionId ||
      snapshot.projectId !== event.projectId ||
      event.eventId !== event.requestId
    )
      return yield* Effect.fail(
        new StudyError('invalid_input', 'Recording event does not match captured intent')
      );

    if (snapshot.messageId !== null)
      return yield* recordings.recordingPost({ requestId: event.requestId });

    const sourceId = yield* Activity.make({
      name: 'import-recording',
      success: sourceIdSchema,
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        sources.importRecording({
          requestId: event.requestId,
          projectId: snapshot.projectId,
          sessionId: snapshot.sessionId,
          name: snapshot.name,
          bytes: snapshot.bytes,
          durationMs: snapshot.durationMs
        })
      ).pipe(Effect.map((source: typeof sourceSchema.Type) => source.id))
    });
    const messageId = yield* Activity.make({
      name: 'attach-recording',
      success: messageIdSchema,
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        conversations.postRecordingMessage({
          requestId: event.requestId,
          projectId: snapshot.projectId,
          sessionId: snapshot.sessionId,
          sourceId,
          durationMs: snapshot.durationMs
        })
      )
    });

    return yield* Activity.make({
      name: 'finish-recording-post',
      success: recordingPostSchema,
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        recordings.finishRecordingPost({ requestId: event.requestId, sourceId, messageId })
      )
    });
  });

export const recordingPostHandlerLayer = recordingPostWorkflow.toLayer(recordingPostHandler);

export function recordingPostRequestedTrigger(enabled: () => boolean): Trigger {
  return {
    subscription: 'recording-post',
    event: 'RecordingPostRequested',
    workflowVersion: 1,
    workflow: recordingPostWorkflow,
    emits: ['SourceProcessingRequested'],
    enabled
  };
}

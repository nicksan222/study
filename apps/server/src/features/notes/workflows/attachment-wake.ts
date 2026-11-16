/** @file Owns attachment wake within this feature. */

import {
  StudyError,
  failureSchema,
  sourceCorrectionRequestedSchema,
  sourceDeletedSchema,
  sourceIndexedSchema,
  sourceProcessingFailedSchema,
  sourceProcessingRequestedSchema,
  sourceProjectChangedSchema
} from '@study/contracts';
import { Effect, Result, Schema } from 'effect';
import { DurableDeferred } from 'effect/workflow';

import { Notes } from '#server/features/notes/service/index';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';

import { attachmentGate } from './internal/attachment-gate.ts';
import { noteReplyWorkflow } from './reply.ts';

const sourceWakeEventSchema = Schema.Union([
  sourceIndexedSchema,
  sourceDeletedSchema,
  sourceProjectChangedSchema,
  sourceProcessingFailedSchema,
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema
]);

export const noteAttachmentWakeWorkflow = defineWorkflow({
  name: 'conversation-attachment-wake',
  version: 1,
  payload: Schema.Struct({ event: sourceWakeEventSchema }),
  success: Schema.Void,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const noteAttachmentWakeHandler = Effect.fnUntraced(function* ({
  event
}: typeof noteAttachmentWakeWorkflow.payloadSchema.Type) {
  const notes = yield* Notes;
  let after: string | undefined;

  for (;;) {
    const page = yield* notes.replyWakes({ sourceId: event.sourceId, after, limit: 100 });

    function* wakeReply(row: (typeof page)[number]) {
      const readiness = yield* Effect.result(notes.replyReadiness({ requestId: row.requestId }));

      if (Result.isFailure(readiness)) {
        if (!['invalid_input', 'not_found', 'unsupported'].includes(readiness.failure.kind))
          return yield* Effect.fail(readiness.failure);

        for (const part of row.pendingAttachments) {
          const gate = attachmentGate(part.sourceId, part.requestId);

          yield* DurableDeferred.fail(gate, {
            token: DurableDeferred.tokenFromExecutionId(gate, {
              workflow: noteReplyWorkflow,
              executionId: row.executionId
            }),
            error: new StudyError('invalid_input', 'Captured attachment is unavailable')
          });
        }
      } else {
        for (const part of row.pendingAttachments) {
          if (
            readiness.success.some(
              (item) => item.sourceId === part.sourceId && item.requestId === part.requestId
            )
          )
            continue;

          const gate = attachmentGate(part.sourceId, part.requestId);

          yield* DurableDeferred.succeed(gate, {
            token: DurableDeferred.tokenFromExecutionId(gate, {
              workflow: noteReplyWorkflow,
              executionId: row.executionId
            }),
            value: undefined
          });
        }
      }
    }

    for (const row of page) yield* Effect.gen(() => wakeReply(row));

    if (page.length < 100) break;

    after = page.at(-1)!.requestId;
  }
});

export const noteAttachmentWakeRegistration = defineWorkflowHandler(noteAttachmentWakeWorkflow, {
  execute: noteAttachmentWakeHandler,
  triggers: (
    [
      'SourceIndexed',
      'SourceDeleted',
      'SourceProjectChanged',
      'SourceProcessingFailed',
      'SourceProcessingRequested',
      'SourceCorrectionRequested'
    ] as const
  ).map((event) => ({
    subscription: `conversation-attachment-wake/${event.toLowerCase()}`,
    event,
    emits: []
  }))
});

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs retryable note cleanup using native cancellation and guarded Activity.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema } from '@study/contracts/errors';
import { noteDeletionRequestedSchema } from '@study/contracts/events';
import { noteDeletionSchema } from '@study/contracts/notes/deletion';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { Effect, Schema } from 'effect';

import { Notes } from '#server/features/notes/index';
import { Database } from '#server/platform/database/database';
import { defineActivity } from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { WorkflowControl } from '#server/platform/workflows/control';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity, settleWorkflowFailure } from '#server/platform/workflows/retry';

export const noteDeletionWorkflow = defineWorkflow({
  name: 'session-deletion',
  version: 1,
  payload: Schema.Struct({ event: noteDeletionRequestedSchema }),
  success: noteDeletionSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const noteDeletionHandler = ({ event }: typeof noteDeletionWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const control = yield* WorkflowControl;
    const { store } = yield* Database;
    const previous = yield* notes.noteDeletion(event.noteId);

    if (previous.status === 'completed' || previous.attempt !== event.attempt) return previous;

    return yield* retryResumableActivity(
      defineActivity({
        name: 'retire-session-content',
        success: noteDeletionSchema,

        execute: function* () {
          const ids = yield* notes.noteDeletionExecutions(event.noteId);

          for (const id of ids)
            yield* control.cancel({
              id: Schema.decodeUnknownSync(executionIdSchema)(id),
              mode: 'unsafe'
            });

          return yield* withPublicationGuard(
            store,
            notes.finishNoteDeletion({
              noteId: event.noteId,
              attempt: event.attempt
            })
          );
        }
      })
    ).pipe(
      Effect.catchCause((cause) =>
        settleWorkflowFailure(cause, 'Note cleanup failed', (kind) =>
          notes.failNoteDeletion({
            noteId: event.noteId,
            errorKind: kind,
            attempt: event.attempt
          })
        )
      )
    );
  });

export const noteDeletionRegistration = defineWorkflowHandler(noteDeletionWorkflow, {
  execute: noteDeletionHandler,
  triggers: [{ subscription: 'session-deletion', event: 'NoteDeletionRequested', emits: [] }]
});

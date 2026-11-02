/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs retryable session cleanup using native cancellation and guarded Activity.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sessionDeletionSchema } from '@study/contracts/conversations/deletion';
import { failureSchema, StudyError } from '@study/contracts/errors';
import { sessionDeletionRequestedSchema } from '@study/contracts/events';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { Cause, Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { WorkflowControl } from '#server/platform/workflows/control';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const sessionDeletionWorkflow = defineWorkflow({
  name: 'session-deletion',
  version: 1,
  payload: Schema.Struct({ event: sessionDeletionRequestedSchema }),
  success: sessionDeletionSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const sessionDeletionHandler = ({
  event
}: typeof sessionDeletionWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const control = yield* WorkflowControl;
    const { store } = yield* Database;
    const previous = yield* conversations.sessionDeletion(event.sessionId);

    if (previous.status === 'completed' || previous.attempt !== event.attempt) return previous;

    return yield* retryResumableActivity(
      Activity.make({
        name: 'retire-session-content',
        success: sessionDeletionSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const ids = yield* conversations.sessionDeletionExecutions(event.sessionId);

          for (const id of ids)
            yield* control.cancel({
              id: Schema.decodeUnknownSync(executionIdSchema)(id),
              mode: 'unsafe'
            });

          return yield* withPublicationGuard(
            store,
            conversations.finishSessionDeletion({
              sessionId: event.sessionId,
              attempt: event.attempt
            })
          );
        })
      })
    ).pipe(
      Effect.catchCause((cause) => {
        const failure = Cause.squash(cause);
        const kind =
          failure instanceof StudyError
            ? failure.kind
            : Cause.hasInterrupts(cause)
              ? 'cancelled'
              : 'internal';
        const error = new StudyError(kind, 'Session cleanup failed');

        return conversations
          .failSessionDeletion({
            sessionId: event.sessionId,
            errorKind: kind,
            attempt: event.attempt
          })
          .pipe(Effect.uninterruptible, Effect.andThen(Effect.fail(error)));
      })
    );
  });

export const sessionDeletionRegistration = defineWorkflowHandler(sessionDeletionWorkflow, {
  execute: sessionDeletionHandler,
  triggers: [{ subscription: 'session-deletion', event: 'SessionDeletionRequested', emits: [] }]
});

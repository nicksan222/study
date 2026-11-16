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

import { failureSchema } from '@study/contracts';
import { noteDeletionRequestedSchema } from '@study/contracts';
import { noteDeletionSchema } from '@study/contracts';
import { Database, defineWorkflow, defineWorkflowHandler, cleanupActivity } from '@study/server';
import { Effect, Schema } from 'effect';

import { Notes } from '#server/features/notes/index';

export const noteDeletionWorkflow = defineWorkflow({
  name: 'session-deletion',
  version: 1,
  payload: Schema.Struct({ event: noteDeletionRequestedSchema }),
  success: noteDeletionSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const noteDeletionHandler = Effect.fnUntraced(function* ({
  event
}: typeof noteDeletionWorkflow.payloadSchema.Type) {
  const notes = yield* Notes;
  const { store } = yield* Database;
  const previous = yield* notes.noteDeletion(event.noteId);

  if (previous.status === 'completed' || previous.attempt !== event.attempt) return previous;

  return yield* cleanupActivity(store, {
    name: 'retire-session-content',
    success: noteDeletionSchema,
    executions: notes.noteDeletionExecutions(event.noteId),
    publish: notes.finishNoteDeletion({ noteId: event.noteId, attempt: event.attempt }),
    settle: (errorKind) =>
      notes.failNoteDeletion({ noteId: event.noteId, errorKind, attempt: event.attempt }),
    failureMessage: 'Note cleanup failed'
  });
});

export const noteDeletionRegistration = defineWorkflowHandler(noteDeletionWorkflow, {
  execute: noteDeletionHandler,
  triggers: [{ subscription: 'session-deletion', event: 'NoteDeletionRequested', emits: [] }]
});

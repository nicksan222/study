/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs title generation as a resumable workflow and records its result through the   │
 * │ note service.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Runs title requests through durable activities before publishing a note update.        │
 * │ - Uses checkpoints and publication guards around durable state changes.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Effect Workflow owns durable execution; the notes service owns domain writes             │
 * │ performed by guarded activities.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema, StudyError } from '@study/contracts/errors';
import { noteTitleRequestedSchema } from '@study/contracts/events';
import { publishTitleInputSchema, titleRequestSchema } from '@study/contracts/notes/schemas';
import { Effect, Schema } from 'effect';

import { titleAgent } from '#server/features/notes/agents/title';
import { Notes } from '#server/features/notes/service/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import { defineActivity, publicationActivity } from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const noteTitleWorkflow = defineWorkflow({
  name: 'conversation-title',
  version: 1,
  payload: Schema.Struct({ event: noteTitleRequestedSchema }),
  success: titleRequestSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const noteTitleHandler = ({ event }: typeof noteTitleWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const { store } = yield* Database;
    const publication = yield* retryResumableActivity(
      defineActivity({
        name: 'generate-title',
        success: publishTitleInputSchema,

        execute: function* () {
          const snapshot = yield* notes.titleSnapshot({
            requestId: event.requestId,
            eventId: event.eventId
          });

          if (
            snapshot.noteId !== event.noteId ||
            snapshot.contextRevision !== event.contextRevision ||
            snapshot.title !== event.title ||
            snapshot.titleSource !== event.titleSource ||
            JSON.stringify(snapshot.messages, (_key, value) =>
              typeof value === 'bigint' ? value.toString() : value
            ) !==
              JSON.stringify(event.messages, (_key, value) =>
                typeof value === 'bigint' ? value.toString() : value
              )
          )
            return yield* Effect.fail(
              new StudyError('invalid_input', 'Title event identity mismatch')
            );

          const output = yield* generateAgent(
            titleAgent,
            {
              prompt: JSON.stringify({
                title: snapshot.title,
                messages: snapshot.messages.map(({ role, text }) => ({ role, text }))
              })
            },
            {
              maxRetries: 0,
              preflight: notes
                .titleSnapshot({ requestId: event.requestId, eventId: event.eventId })
                .pipe(Effect.asVoid)
            }
          );
          const title = output.trim();

          if (!title || [...title].length > 200)
            return yield* Effect.fail(new StudyError('invalid_input', 'invalid generated title'));

          return { requestId: event.requestId, title };
        }
      })
    );

    return yield* publicationActivity(store, {
      name: 'publish-title',
      success: titleRequestSchema,

      execute: notes.publishTitle(publication)
    });
  });

export const noteTitleRegistration = defineWorkflowHandler(noteTitleWorkflow, {
  execute: noteTitleHandler,
  triggers: [
    {
      subscription: 'conversation-title',
      event: 'NoteTitleRequested',
      emits: []
    }
  ]
});

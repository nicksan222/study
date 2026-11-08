/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs question detection through durable generation and publication activities.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses the tiny classifier with resumable activity checkpoints.                          │
 * │ - Publishes guarded classifications and schedules opted in answers.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Effect Workflow owns execution while the note service owns domain writes.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema, StudyError } from '@study/contracts/errors';
import { noteQuestionRequestedSchema } from '@study/contracts/events';
import { questionClassificationSchema } from '@study/contracts/notes/schemas';
import { Effect, Schema } from 'effect';

import { questionAgent } from '#server/features/notes/agents/question';
import { Notes } from '#server/features/notes/service/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import {
  publicationActivity,
  resumableActivity
} from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';

export const noteQuestionWorkflow = defineWorkflow({
  name: 'conversation-question',
  version: 1,
  payload: Schema.Struct({ event: noteQuestionRequestedSchema }),
  success: Schema.Void,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

/** Checkpoints generation and publishes only while the question version remains current. */
export const noteQuestionHandler = ({ event }: typeof noteQuestionWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const c = yield* Notes;
    const database = yield* Database;
    const { store } = database;
    const input = { messageId: event.messageId, expectedActiveVersionId: event.versionId };
    const output = yield* resumableActivity({
      name: 'classify-question',
      success: questionClassificationSchema,

      execute: function* () {
        const snapshot = yield* c.questionSnapshot(input);

        if (snapshot.manual) return { kind: snapshot.kind ?? 'undetermined' };

        return yield* generateAgent(
          questionAgent,
          { text: snapshot.text },
          {
            maxRetries: 0,
            preflight: c.questionSnapshot(input).pipe(
              Effect.flatMap((s) =>
                s.manual
                  ? Effect.fail(
                      new StudyError('invalid_input', 'Question classification is manual')
                    )
                  : Effect.void
              ),
              Effect.provideService(Database, database)
            )
          }
        );
      }
    });

    yield* publicationActivity(store, {
      name: 'publish-question',
      success: Schema.Void,

      execute: c.publishQuestion({ ...input, ...output })
    });
  }).pipe(
    Effect.catch((error) =>
      ['invalid_input', 'not_found', 'cancelled'].includes(error.kind)
        ? Effect.void
        : Effect.fail(error)
    )
  );

export const noteQuestionRegistration = defineWorkflowHandler(noteQuestionWorkflow, {
  execute: noteQuestionHandler,
  triggers: [
    {
      subscription: 'conversation-question',
      event: 'NoteQuestionRequested',
      emits: ['NoteGenerationRequested']
    }
  ]
});

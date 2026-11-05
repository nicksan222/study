/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs question detection through durable generation and publication activities.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses the tiny classifier with resumable activity checkpoints.                          │
 * │ - Publishes guarded classifications and schedules opted in answers.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Effect Workflow owns execution while the conversation service owns domain writes. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { questionClassificationSchema } from '@study/contracts/conversations/schemas';
import { failureSchema, StudyError } from '@study/contracts/errors';
import { conversationQuestionRequestedSchema } from '@study/contracts/events';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { questionAgent } from '#server/features/conversations/agents/question';
import { Conversations } from '#server/features/conversations/service/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const conversationQuestionWorkflow = defineWorkflow({
  name: 'conversation-question',
  version: 1,
  payload: Schema.Struct({ event: conversationQuestionRequestedSchema }),
  success: Schema.Void,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const conversationQuestionHandler = ({
  event
}: typeof conversationQuestionWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const c = yield* Conversations;
    const database = yield* Database;
    const { store } = database;
    const input = { messageId: event.messageId, expectedActiveVersionId: event.versionId };
    const output = yield* retryResumableActivity(
      Activity.make({
        name: 'classify-question',
        success: questionClassificationSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const snapshot = yield* c.questionSnapshot(input);

          if (snapshot.manual)
            return yield* Effect.fail(
              new StudyError('invalid_input', 'Question classification is manual')
            );

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
        })
      })
    );

    yield* Activity.make({
      name: 'publish-question',
      success: Schema.Void,
      error: failureSchema,
      execute: withPublicationGuard(store, c.publishQuestion({ ...input, ...output }))
    });
  }).pipe(
    Effect.catch((error) =>
      ['invalid_input', 'not_found', 'cancelled'].includes(error.kind)
        ? Effect.void
        : Effect.fail(error)
    )
  );

export const conversationQuestionRegistration = defineWorkflowHandler(
  conversationQuestionWorkflow,
  {
    execute: conversationQuestionHandler,
    triggers: [
      {
        subscription: 'conversation-question',
        event: 'ConversationQuestionRequested',
        emits: ['ConversationGenerationRequested']
      }
    ]
  }
);

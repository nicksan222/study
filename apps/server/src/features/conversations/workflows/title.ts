import {
  publishTitleInputSchema,
  titleRequestSchema
} from '@study/contracts/conversations/schemas';
import { failureSchema, StudyError } from '@study/contracts/errors';
import { conversationTitleRequestedSchema } from '@study/contracts/events';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { titleAgent } from '#server/features/conversations/agents/title';
import { Conversations } from '#server/features/conversations/service/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const conversationTitleWorkflow = defineWorkflow({
  name: 'conversation-title',
  version: 1,
  payload: Schema.Struct({ event: conversationTitleRequestedSchema }),
  success: titleRequestSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const conversationTitleHandler = ({
  event
}: typeof conversationTitleWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const { store } = yield* Database;
    const publication = yield* retryResumableActivity(
      Activity.make({
        name: 'generate-title',
        success: publishTitleInputSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const snapshot = yield* conversations.titleSnapshot({
            requestId: event.requestId,
            eventId: event.eventId
          });

          if (
            snapshot.sessionId !== event.sessionId ||
            snapshot.projectId !== event.projectId ||
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
            { prompt: JSON.stringify(snapshot.messages.map(({ role, text }) => ({ role, text }))) },
            {
              maxRetries: 0,
              preflight: conversations
                .titleSnapshot({ requestId: event.requestId, eventId: event.eventId })
                .pipe(Effect.asVoid)
            }
          );
          const title = output.trim();

          if (!title || [...title].length > 200)
            return yield* Effect.fail(new StudyError('invalid_input', 'invalid generated title'));

          return { requestId: event.requestId, title };
        })
      })
    );

    return yield* Activity.make({
      name: 'publish-title',
      success: titleRequestSchema,
      error: failureSchema,
      execute: withPublicationGuard(store, conversations.publishTitle(publication))
    });
  });

export const conversationTitleRegistration = defineWorkflowHandler(conversationTitleWorkflow, {
  execute: conversationTitleHandler,
  triggers: [
    {
      subscription: 'conversation-title',
      event: 'ConversationTitleRequested',
      emits: []
    }
  ]
});

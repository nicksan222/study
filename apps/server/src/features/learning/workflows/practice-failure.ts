/** @file Owns practice failure within this feature. */

import { failureSchema, materialGenerationFailedSchema } from '@study/contracts';
import { Effect, Schema } from 'effect';

import { Learning } from '#server/features/learning/service/index';
import { Database } from '#server/platform/database/database';
import { publicationActivity } from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';

export const practiceFailureWorkflow = defineWorkflow({
  name: 'practice-failure',
  version: 1,
  payload: Schema.Struct({ event: materialGenerationFailedSchema }),
  success: Schema.Boolean,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const practiceFailureHandler = Effect.fnUntraced(function* ({
  event
}: typeof practiceFailureWorkflow.payloadSchema.Type) {
  if (event.kind !== 'quiz' || event.projectId === undefined) return false;

  const learning = yield* Learning;
  const { store } = yield* Database;

  return yield* publicationActivity(store, {
    name: 'fail-practice-slot',
    success: Schema.Boolean,

    execute: learning.failPracticeSlot({
      slotId: event.requestId,
      projectId: event.projectId,
      generationEventId: event.generationEventId,
      errorKind: event.errorKind
    })
  });
});

export const practiceFailureRegistration = defineWorkflowHandler(practiceFailureWorkflow, {
  execute: practiceFailureHandler,
  triggers: [
    {
      subscription: 'practice-failure',
      event: 'MaterialGenerationFailed',
      emits: []
    }
  ]
});

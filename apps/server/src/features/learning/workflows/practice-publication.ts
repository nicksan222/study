/** @file Owns practice publication within this feature. */

import { failureSchema, materialPublishedSchema } from '@study/contracts';
import { Effect, Schema } from 'effect';

import { Learning } from '#server/features/learning/service/index';
import { Database } from '#server/platform/database/database';
import { publicationActivity } from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';

export const practicePublicationWorkflow = defineWorkflow({
  name: 'practice-publication',
  version: 1,
  payload: Schema.Struct({ event: materialPublishedSchema }),
  success: Schema.Boolean,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const practicePublicationHandler = Effect.fnUntraced(function* ({
  event
}: typeof practicePublicationWorkflow.payloadSchema.Type) {
  const slotId = event.generationRequestId ?? event.causationId;

  if (!slotId || !Schema.is(Schema.String.check(Schema.isUUID()))(slotId)) return false;

  const learning = yield* Learning;
  const { store } = yield* Database;

  return yield* publicationActivity(store, {
    name: 'publish-practice-slot',
    success: Schema.Boolean,

    execute: learning
      .publishPracticeSlot({ slotId, versionId: event.materialVersionId })
      .pipe(Effect.map((result) => result !== null))
  });
});

export const practicePublicationRegistration = defineWorkflowHandler(practicePublicationWorkflow, {
  execute: practicePublicationHandler,
  triggers: [
    {
      subscription: 'practice-publication',
      event: 'MaterialPublished',
      emits: []
    }
  ]
});

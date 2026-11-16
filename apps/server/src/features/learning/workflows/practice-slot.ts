/** @file Owns practice slot within this feature. */

import { failureSchema, practiceSlotRequestedSchema } from '@study/contracts';
import { text } from '@study/localization';
import { Effect, Schema } from 'effect';

import { Learning } from '#server/features/learning/service/index';
import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { defineActivity } from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';

export const practiceSlotWorkflow = defineWorkflow({
  name: 'practice-slot',
  version: 1,
  payload: Schema.Struct({ event: practiceSlotRequestedSchema }),
  success: Schema.Boolean,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const practiceSlotHandler = Effect.fnUntraced(function* ({
  event
}: typeof practiceSlotWorkflow.payloadSchema.Type) {
  const learning = yield* Learning;
  const materials = yield* Materials;
  const settings = yield* Settings;

  return yield* defineActivity({
    name: 'request-practice-material',
    success: Schema.Boolean,

    execute: function* () {
      const slot = yield* learning.practiceSlot(event.slotId);

      const attempt = event.generationAttempt ?? 0;

      if (
        !slot ||
        slot.status !== 'pending' ||
        slot.generationAttempt !== BigInt(attempt) ||
        slot.epoch !== event.epoch ||
        slot.projectId !== event.projectId
      )
        return false;

      yield* materials.openGenerationScope({ scopeId: slot.epoch, projectId: slot.projectId });

      const generationEventId = attempt === 0 ? slot.slotId : `${slot.slotId}/retry/${attempt}`;
      const captured = yield* materials
        .materialGeneration({ requestId: slot.slotId, verifyOnly: true })
        .pipe(
          Effect.catch((error) =>
            error.kind === 'not_found' ? Effect.succeed(undefined) : Effect.fail(error)
          )
        );
      const request = captured ?? {
        projectId: slot.projectId,
        title: text(yield* settings.language(), 'PracticeQuestionTitle'),
        kind: 'quiz' as const,
        inputs: slot.inputs,
        scopeId: slot.epoch,
        questionSpec: { count: 1 as const, kind: slot.kind }
      };

      yield* materials.requestMaterialGenerationAttemptOnce({
        requestId: slot.slotId,
        generationEventId,
        request
      });

      return true;
    }
  });
});

export const practiceSlotRegistration = defineWorkflowHandler(practiceSlotWorkflow, {
  workload: 'bulk',
  execute: practiceSlotHandler,
  triggers: [
    {
      subscription: 'practice-slot',
      event: 'PracticeSlotRequested',
      emits: ['MaterialGenerationRequested']
    }
  ]
});

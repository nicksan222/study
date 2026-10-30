import { gradeOutputSchema } from '@study/contracts/ai/grade';
import { failureSchema } from '@study/contracts/errors';
import {
  quizAnswerSubmittedSchema,
  practiceSlotRequestedSchema,
  materialGenerationFailedSchema,
  materialPublishedSchema
} from '@study/contracts/events';
import { quizAttemptInProgressSchema } from '@study/contracts/learning/schemas';
import { text } from '@study/localization';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { learningGradeAgent } from '#server/features/learning/agents/learning-grade';
import { Learning } from '#server/features/learning/service/index';
import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const quizGradingWorkflow = defineWorkflow({
  name: 'quiz-grading',
  version: 1,
  payload: Schema.Struct({ event: quizAnswerSubmittedSchema }),
  success: quizAttemptInProgressSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const quizGradingHandler = ({ event }: typeof quizGradingWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const learning = yield* Learning;
    const { store } = yield* Database;
    const grade = yield* retryResumableActivity(
      Activity.make({
        name: 'grade-answer',
        success: gradeOutputSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const snapshot = yield* learning.gradingSnapshot(event);

          return yield* generateAgent(
            learningGradeAgent,
            {
              prompt: JSON.stringify({
                question: snapshot.prompt,
                reference: snapshot.referenceAnswer,
                answer: snapshot.learnerAnswer
              })
            },
            { maxRetries: 0, preflight: learning.gradingSnapshot(event).pipe(Effect.asVoid) }
          );
        })
      })
    );

    return yield* Activity.make({
      name: 'publish-grade',
      success: quizAttemptInProgressSchema,
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        learning.publishGrade({
          attemptId: event.attemptId,
          questionId: event.questionId,
          expectedAnswerHash: event.answerHash,
          score: grade.verdict === 'correct' ? 1 : grade.verdict === 'partly' ? 0.5 : 0,
          feedback: grade.feedback
        })
      )
    });
  });

export const quizGradingRegistration = defineWorkflowHandler(quizGradingWorkflow, {
  execute: quizGradingHandler,
  triggers: [
    {
      subscription: 'quiz-grading',
      event: 'QuizAnswerSubmitted',
      emits: []
    }
  ]
});

export const practiceSlotWorkflow = defineWorkflow({
  name: 'practice-slot',
  version: 1,
  payload: Schema.Struct({ event: practiceSlotRequestedSchema }),
  success: Schema.Boolean,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const practiceSlotHandler = ({ event }: typeof practiceSlotWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const learning = yield* Learning;
    const materials = yield* Materials;
    const settings = yield* Settings;

    return yield* Activity.make({
      name: 'request-practice-material',
      success: Schema.Boolean,
      error: failureSchema,
      execute: Effect.gen(function* () {
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
          inputVersionIds: slot.inputVersionIds,
          scopeId: slot.epoch,
          questionSpec: { count: 1 as const, kind: slot.kind }
        };

        yield* materials.requestMaterialGenerationAttemptOnce({
          requestId: slot.slotId,
          generationEventId,
          request
        });

        return true;
      })
    });
  });

export const practiceSlotRegistration = defineWorkflowHandler(practiceSlotWorkflow, {
  execute: practiceSlotHandler,
  triggers: [
    {
      subscription: 'practice-slot',
      event: 'PracticeSlotRequested',
      emits: ['MaterialGenerationRequested']
    }
  ]
});

export const practiceFailureWorkflow = defineWorkflow({
  name: 'practice-failure',
  version: 1,
  payload: Schema.Struct({ event: materialGenerationFailedSchema }),
  success: Schema.Boolean,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const practiceFailureHandler = ({
  event
}: typeof practiceFailureWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    if (event.kind !== 'quiz') return false;

    const learning = yield* Learning;
    const { store } = yield* Database;

    return yield* Activity.make({
      name: 'fail-practice-slot',
      success: Schema.Boolean,
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        learning.failPracticeSlot({
          slotId: event.requestId,
          projectId: event.projectId,
          generationEventId: event.generationEventId,
          errorKind: event.errorKind
        })
      )
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

export const practicePublicationWorkflow = defineWorkflow({
  name: 'practice-publication',
  version: 1,
  payload: Schema.Struct({ event: materialPublishedSchema }),
  success: Schema.Boolean,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const practicePublicationHandler = ({
  event
}: typeof practicePublicationWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const slotId = event.generationRequestId ?? event.causationId;

    if (!slotId || !Schema.is(Schema.String.check(Schema.isUUID()))(slotId)) return false;

    const learning = yield* Learning;
    const { store } = yield* Database;

    return yield* Activity.make({
      name: 'publish-practice-slot',
      success: Schema.Boolean,
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        learning
          .publishPracticeSlot({ slotId, versionId: event.materialVersionId })
          .pipe(Effect.map((result) => result !== null))
      )
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

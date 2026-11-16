/** @file Owns grading within this feature. */

import {
  failureSchema,
  gradeOutputSchema,
  quizAnswerSubmittedSchema,
  quizAttemptSchema
} from '@study/contracts';
import { Effect, Schema } from 'effect';

import { learningGradeAgent } from '#server/features/learning/agents/learning-grade';
import { Learning } from '#server/features/learning/service/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import {
  publicationActivity,
  resumableActivity
} from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';

export const quizGradingWorkflow = defineWorkflow({
  name: 'quiz-grading',
  version: 1,
  payload: Schema.Struct({ event: quizAnswerSubmittedSchema }),
  success: quizAttemptSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const quizGradingHandler = Effect.fnUntraced(function* ({
  event
}: typeof quizGradingWorkflow.payloadSchema.Type) {
  const learning = yield* Learning;
  const { store } = yield* Database;
  const grade = yield* resumableActivity({
    name: 'grade-answer',
    success: gradeOutputSchema,

    execute: function* () {
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
    }
  });

  return yield* publicationActivity(store, {
    name: 'publish-grade',
    success: quizAttemptSchema,

    execute: learning.publishGrade({
      attemptId: event.attemptId,
      questionId: event.questionId,
      expectedAnswerHash: event.answerHash,
      score: grade.verdict === 'correct' ? 1 : grade.verdict === 'partly' ? 0.5 : 0,
      feedback: grade.feedback
    })
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

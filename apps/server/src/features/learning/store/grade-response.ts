/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists grading results for a learner response.                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists typed grading outcomes associated with the owning quiz attempt.               │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the learning service applies policy and         │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { gradeResponseInputSchema } from '@study/contracts/learning/rpc';
import { isTextQuestionKind } from '@study/contracts/materials/schemas';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { makeQuiz } from './quiz.ts';

type Input = typeof gradeResponseInputSchema.Type;

export function makeGradeResponse(resources: StoreResources) {
  const { db } = resources;
  const { attemptRow, attemptView, attemptQuestions } = makeQuiz(resources);
  /** Stores a text grade for a selected response; a completed response can receive its first grade only once. */
  const settleGrade = (input: Input) => {
    const a = attemptRow(input.attemptId);

    if (!attemptQuestions(a.id).some((question) => question.id === input.questionId))
      invalid('question does not belong to attempt selection');

    const where = and(
      eq(s.material_quiz_responses.attempt_id, a.id),
      eq(s.material_quiz_responses.question_id, input.questionId)
    );
    const response = db.orm.select().from(s.material_quiz_responses).where(where).get();

    if (!response || !isTextQuestionKind(response.question_kind) || !response.answer?.trim())
      invalid('open response required');

    if (a.status === 'completed' && response.score !== null)
      invalid('completed grade is immutable');

    db.orm
      .update(s.material_quiz_responses)
      .set({
        score: input.score,
        feedback: input.feedback
      })
      .where(where)
      .run();

    return attemptView(a.id);
  };
  const gradeResponse = (input: Input) => {
    attemptRow(input.attemptId, true);
    const result = settleGrade(input);

    if (result.status !== 'in_progress') invalid('quiz attempt completed');

    return result;
  };

  return {
    gradeResponse,
    settleGrade
  };
}

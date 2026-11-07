/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Records a learner’s answer to an active question.                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates active attempt ownership before recording the learner response.              │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the learning service applies policy and         │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { answerQuestionInputSchema } from '@study/contracts/learning/rpc';
import { isTextQuestionKind } from '@study/contracts/materials/schemas';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { makeQuiz } from './quiz.ts';

type Input = typeof answerQuestionInputSchema.Type;

export function makeAnswerQuestion(resources: StoreResources) {
  const { db } = resources;
  const { attemptRow, attemptView, choiceScore, attemptQuestions } = makeQuiz(resources);
  /** Records a typed answer only for a selected question and its owning practice slot; choice scores are computed immediately. */
  const answerQuestion = (input: Input, practiceSlotId?: string) => {
    const practice = db.orm
      .select({
        id: s.learning_practice_slots.id,
        status: s.learning_practice_slots.status
      })
      .from(s.learning_practice_slots)
      .where(eq(s.learning_practice_slots.attempt_id, input.attemptId))
      .get();

    if (practice && (practice.id !== practiceSlotId || practice.status !== 'ready'))
      invalid('practice attempts must be answered through their practice slot');

    const a = attemptRow(input.attemptId, true);
    const q = attemptQuestions(a.id).find((question) => question.id === input.questionId);

    if (!q) invalid('question does not belong to attempt selection');

    if (isTextQuestionKind(q.kind) !== (input.answer.type === 'open')) invalid('wrong answer kind');

    const score = input.answer.type === 'choice' ? choiceScore(q, input.answer.choiceIds) : null;

    db.orm
      .delete(s.material_quiz_selections)
      .where(
        and(
          eq(s.material_quiz_selections.attempt_id, a.id),
          eq(s.material_quiz_selections.question_id, q.id)
        )
      )
      .run();
    const values = {
      attempt_id: a.id,
      version_id: a.version_id,
      question_id: q.id,
      question_kind: q.kind,
      answer: input.answer.type === 'open' ? input.answer.answer : null,
      score,
      feedback: null
    };

    db.orm
      .insert(s.material_quiz_responses)
      .values(values)
      .onConflictDoUpdate({
        target: [s.material_quiz_responses.attempt_id, s.material_quiz_responses.question_id],
        set: values
      })
      .run();

    if (input.answer.type === 'choice')
      db.orm
        .insert(s.material_quiz_selections)
        .values(
          input.answer.choiceIds.map((choice_id) => ({
            attempt_id: a.id,
            question_id: q.id,
            choice_id
          }))
        )
        .run();

    const result = attemptView(a.id);

    if (result.status !== 'in_progress') invalid('quiz attempt completed');

    return result;
  };

  return {
    answerQuestion
  };
}

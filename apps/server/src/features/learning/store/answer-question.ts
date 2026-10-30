import type { answerQuestionInputSchema } from '@study/contracts/learning/rpc';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { makeQuiz } from './quiz.ts';

type Input = typeof answerQuestionInputSchema.Type;

export function makeAnswerQuestion(resources: StoreResources) {
  const { db } = resources;
  const { attemptRow, attemptView, choiceScore } = makeQuiz(resources);
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
    const q = db.orm
      .select()
      .from(s.material_quiz_questions)
      .where(
        and(
          eq(s.material_quiz_questions.id, input.questionId),
          eq(s.material_quiz_questions.version_id, a.version_id)
        )
      )
      .get();

    if (!q) invalid('question does not belong to attempt version');

    if ((q.kind === 'open') !== (input.answer.type === 'open')) invalid('wrong answer kind');

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

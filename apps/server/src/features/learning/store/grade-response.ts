import type { gradeResponseInputSchema } from '@study/contracts/learning/rpc';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { makeQuiz } from './quiz.ts';

type Input = typeof gradeResponseInputSchema.Type;

export function makeGradeResponse(resources: StoreResources) {
  const { db } = resources;
  const { attemptRow, attemptView } = makeQuiz(resources);
  const gradeResponse = (input: Input) => {
    const a = attemptRow(input.attemptId, true);
    const where = and(
      eq(s.material_quiz_responses.attempt_id, a.id),
      eq(s.material_quiz_responses.question_id, input.questionId)
    );
    const response = db.orm.select().from(s.material_quiz_responses).where(where).get();

    if (!response || response.question_kind !== 'open' || !response.answer?.trim())
      invalid('open response required');

    db.orm
      .update(s.material_quiz_responses)
      .set({
        score: input.score,
        feedback: input.feedback
      })
      .where(where)
      .run();
    const result = attemptView(a.id);

    if (result.status !== 'in_progress') invalid('quiz attempt completed');

    return result;
  };

  return {
    gradeResponse
  };
}

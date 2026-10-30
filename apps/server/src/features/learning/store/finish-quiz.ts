import type { attemptInputSchema } from '@study/contracts/learning/rpc';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { now, makeQuiz } from './quiz.ts';

type Input = typeof attemptInputSchema.Type;

export function makeFinishQuiz(resources: StoreResources) {
  const { db, clock } = resources;
  const { attemptRow, attemptView, choiceScore, questions } = makeQuiz(resources);
  const finishQuiz = (input: Input) => {
    const a = attemptRow(input.attemptId, true);

    for (const q of questions(a.version_id)) {
      const where = and(
        eq(s.material_quiz_responses.attempt_id, a.id),
        eq(s.material_quiz_responses.question_id, q.id)
      );
      const response = db.orm.select().from(s.material_quiz_responses).where(where).get();

      if (!response) continue;

      const selected = db.orm
        .select()
        .from(s.material_quiz_selections)
        .where(
          and(
            eq(s.material_quiz_selections.attempt_id, a.id),
            eq(s.material_quiz_selections.question_id, q.id)
          )
        )
        .all();

      if (q.kind === 'open') {
        if (!response.answer?.trim() || selected.length) invalid('malformed open response');
      } else {
        const score = choiceScore(
          q,
          selected.map((c) => c.choice_id)
        );

        db.orm
          .update(s.material_quiz_responses)
          .set({
            score,
            feedback: null
          })
          .where(where)
          .run();
      }
    }

    db.orm
      .update(s.material_quiz_attempts)
      .set({
        status: 'completed',
        finished_at: now(clock)
      })
      .where(eq(s.material_quiz_attempts.id, a.id))
      .run();
    const result = attemptView(a.id);

    if (result.status !== 'completed') invalid('quiz completion failed');

    return result;
  };

  return {
    finishQuiz
  };
}

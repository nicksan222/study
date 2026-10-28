import * as s from '@study/db/schema';
import { and, eq } from 'drizzle-orm';

import { attemptRow, attemptView, choiceScore } from '#backend/procedures/learning/quiz';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    ctx.store.transaction(() => {
      const store = ctx.store,
        a = attemptRow(store, input.attemptId, true);
      const q = store.db.orm
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

      const score =
        input.answer.type === 'choice' ? choiceScore(store, q, input.answer.choiceIds) : null;

      store.db.orm
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

      store.db.orm
        .insert(s.material_quiz_responses)
        .values(values)
        .onConflictDoUpdate({
          target: [s.material_quiz_responses.attempt_id, s.material_quiz_responses.question_id],
          set: values
        })
        .run();

      if (input.answer.type === 'choice')
        store.db.orm
          .insert(s.material_quiz_selections)
          .values(
            input.answer.choiceIds.map((choice_id) => ({
              attempt_id: a.id,
              question_id: q.id,
              choice_id
            }))
          )
          .run();

      const result = attemptView(store, a.id);

      if (result.status !== 'in_progress') invalid('quiz attempt completed');

      return result;
    })
  );

import * as s from '@study/db/schema';
import { and, eq } from 'drizzle-orm';

import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

import { attemptInput } from './inputs.ts';
import { attemptRow, attemptView, choiceScore, now, questions } from './quiz.ts';

export const run = publicProcedure.input(attemptInput).mutation(({ ctx, input }) =>
  ctx.store.transaction(() => {
    const store = ctx.store,
      a = attemptRow(store, input.attemptId, true);

    for (const q of questions(store, a.version_id)) {
      const where = and(
        eq(s.material_quiz_responses.attempt_id, a.id),
        eq(s.material_quiz_responses.question_id, q.id)
      );
      const response = store.db.orm.select().from(s.material_quiz_responses).where(where).get();

      if (!response) continue;

      const selected = store.db.orm
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
          store,
          q,
          selected.map((c) => c.choice_id)
        );

        store.db.orm
          .update(s.material_quiz_responses)
          .set({ score, feedback: null })
          .where(where)
          .run();
      }
    }

    store.db.orm
      .update(s.material_quiz_attempts)
      .set({ status: 'completed', finished_at: now() })
      .where(eq(s.material_quiz_attempts.id, a.id))
      .run();
    const result = attemptView(store, a.id);

    if (result.status !== 'completed') invalid('quiz completion failed');

    return result;
  })
);

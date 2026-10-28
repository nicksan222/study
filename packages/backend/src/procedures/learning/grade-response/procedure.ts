import * as s from '@study/db/schema';
import { and, eq } from 'drizzle-orm';

import { attemptRow, attemptView } from '#backend/procedures/learning/quiz';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    ctx.store.transaction(() => {
      const a = attemptRow(ctx.store, input.attemptId, true);
      const where = and(
        eq(s.material_quiz_responses.attempt_id, a.id),
        eq(s.material_quiz_responses.question_id, input.questionId)
      );
      const response = ctx.store.db.orm.select().from(s.material_quiz_responses).where(where).get();

      if (!response || response.question_kind !== 'open' || !response.answer?.trim())
        invalid('open response required');

      ctx.store.db.orm
        .update(s.material_quiz_responses)
        .set({ score: input.score, feedback: input.feedback })
        .where(where)
        .run();

      const result = attemptView(ctx.store, a.id);

      if (result.status !== 'in_progress') invalid('quiz attempt completed');

      return result;
    })
  );

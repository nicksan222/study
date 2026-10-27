import * as s from '@study/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';

import { attemptRow, attemptView } from './quiz.ts';

export const run = publicProcedure
  .input(
    z.object({
      attemptId: idInput,
      questionId: idInput,
      score: z.number().min(0).max(1),
      feedback: z.string().trim().max(100000).nullable().default(null)
    })
  )
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

      return attemptView(ctx.store, a.id);
    })
  );

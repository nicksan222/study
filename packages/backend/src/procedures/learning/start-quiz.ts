import * as s from '@study/db/schema';
import { z } from 'zod';

import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';

import { attemptView, now, published, questions } from './quiz.ts';

export const run = publicProcedure
  .input(z.object({ versionId: idInput }))
  .mutation(({ ctx, input }) =>
    ctx.store.transaction(() => {
      published(ctx.store, input.versionId, 'quiz');

      if (!questions(ctx.store, input.versionId).length) invalid('empty quiz');

      const row = ctx.store.db.orm
        .insert(s.material_quiz_attempts)
        .values({ version_id: input.versionId, status: 'in_progress', started_at: now() })
        .returning()
        .get()!;

      return attemptView(ctx.store, row.id);
    })
  );

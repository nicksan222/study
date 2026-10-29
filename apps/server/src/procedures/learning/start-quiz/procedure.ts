import * as s from '@study/db/schema';

import { attemptView, now, published, questions } from '#server/procedures/learning/quiz';
import { invalid } from '#server/runtime/errors';
import { publicProcedure } from '#server/runtime/trpc';
import { requireRow } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    ctx.store.transaction(() => {
      published(ctx.store, input.versionId, 'quiz');

      if (!questions(ctx.store, input.versionId).length) invalid('empty quiz');

      const row = requireRow(
        ctx.store.db.orm
          .insert(s.material_quiz_attempts)
          .values({ version_id: input.versionId, status: 'in_progress', started_at: now() })
          .returning()
          .get()
      );

      const result = attemptView(ctx.store, row.id);

      if (result.status !== 'in_progress') invalid('quiz attempt initialization failed');

      return result;
    })
  );

import { themes } from '@study/db/schema';

import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) =>
    ctx.store.db.orm
      .select()
      .from(themes)
      .orderBy(themes.id)
      .all()
      .map((row) => row.definition)
  );

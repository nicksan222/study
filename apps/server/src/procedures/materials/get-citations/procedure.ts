import { readCitations } from '#server/procedures/materials/operations/citations';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => readCitations(ctx.store, input.id));

import { job } from '#server/procedures/jobs/operations/job';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => ({ value: job(ctx.store, input.id) }));

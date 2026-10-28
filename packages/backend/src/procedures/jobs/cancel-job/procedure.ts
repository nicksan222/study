import { cancelJob } from '#backend/procedures/jobs/operations/cancel-job';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: cancelJob(ctx.store, input.id) }));

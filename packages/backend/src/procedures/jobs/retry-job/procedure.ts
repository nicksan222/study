import { retryJob } from '#backend/procedures/jobs/operations/retry-job';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const value = retryJob(ctx.store, input.id);

    ctx.wake();

    return { value };
  });

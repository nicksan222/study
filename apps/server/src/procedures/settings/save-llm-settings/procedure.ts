import { releaseWaiting } from '#server/procedures/jobs/worker';
import { writeLlmSettings } from '#server/procedures/settings/operations/save-llm-settings';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    writeLlmSettings(ctx.store, input);
    releaseWaiting(ctx.store);
    ctx.wake();

    return {};
  });

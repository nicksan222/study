import { writeReviewSettings } from '#server/procedures/settings/operations/save-review-settings';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    writeReviewSettings(ctx.store, input);

    return {};
  });

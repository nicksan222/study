import { reviewMaterialCard } from '#server/procedures/learning/operations/review-card';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    reviewMaterialCard(ctx.store, input.versionId, input.cardId, input.rating)
  );

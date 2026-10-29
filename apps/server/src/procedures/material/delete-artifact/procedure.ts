import { deleteArtifact } from '#server/procedures/material/operations/delete-artifact';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: deleteArtifact(ctx.store, input.id) }));

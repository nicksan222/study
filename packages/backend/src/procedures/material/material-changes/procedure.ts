import { materialChanges } from '#backend/procedures/material/operations/material-changes';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => ({ value: materialChanges(ctx.store, input.id) }));

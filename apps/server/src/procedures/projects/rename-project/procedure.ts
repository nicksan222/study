import { renameProject } from '#server/procedures/projects/operations/rename-project';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: renameProject(ctx.store, input.id, input.name) }));

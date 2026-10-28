import { deleteProject } from '#backend/procedures/projects/operations/delete-project';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: deleteProject(ctx.store, input.id) }));

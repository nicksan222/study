import { setSourceProject } from '#backend/procedures/sources/operations/set-source-project';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({
    value: setSourceProject(ctx.store, input.id, input.project ?? null)
  }));

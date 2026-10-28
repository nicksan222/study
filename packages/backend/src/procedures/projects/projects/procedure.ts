import { listProjects } from '#backend/procedures/projects/operations/read-projects';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => ({ items: listProjects(ctx.store) }));

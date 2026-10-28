import { artifactView, artifact } from '#backend/procedures/material/operations/artifact';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const value = artifact(ctx.store, input.id);

    return { value: value ? artifactView(ctx.store, value) : null };
  });

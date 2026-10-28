import { importFile } from '#backend/procedures/sources/operations/import-file';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const source = importFile(ctx.store, input.path, input.project ?? null);

    ctx.wake();

    return source;
  });

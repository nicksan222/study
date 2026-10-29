import { listSources } from '#server/procedures/sources/operations/sources';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => ({
    items: listSources(ctx.store)
  }));

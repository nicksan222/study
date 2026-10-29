import { documentOf } from '#server/procedures/sources/operations/source-document';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const found = documentOf(ctx.store, input.id);

    return { value: found ? { ...found.document, id: found.id } : null };
  });

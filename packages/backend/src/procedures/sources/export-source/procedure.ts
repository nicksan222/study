import { readSourceBounded } from '#backend/procedures/sources/operations/source';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const bytes = readSourceBounded(ctx.store, input.id, 16 * 1024 * 1024);

    if (!bytes) invalid('Source exceeds export limit');

    return { value: bytes };
  });

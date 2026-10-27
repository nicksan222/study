import { z } from 'zod';

import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';

import { readSourceBounded as dbReadSourceBounded } from './source.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;
    const bytes = dbReadSourceBounded(store, r.id, 16 * 1024 * 1024);

    if (!bytes) invalid('Source exceeds export limit');

    return {
      value: bytes
    };
  });

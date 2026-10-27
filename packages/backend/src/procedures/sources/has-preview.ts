import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

import { sourceKindInput } from './reads.ts';

export const run = publicProcedure
  .input(z.object({ kind: sourceKindInput, mime: z.string().nullish() }))
  .query(({ input }) => ({
    value:
      ['text', 'code', 'note', 'web'].some((kind) => kind === input.kind) ||
      (input.kind === 'image' &&
        ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mime ?? ''))
  }));

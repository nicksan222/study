import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ input }) => ({
    value:
      ['text', 'code', 'note', 'web'].includes(input.kind) ||
      (input.kind === 'image' &&
        ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mime ?? ''))
  }));

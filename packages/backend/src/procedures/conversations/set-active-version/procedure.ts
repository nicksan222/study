import { setActiveVersion } from '#backend/procedures/conversations/operations/set-active-version';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({
    value: setActiveVersion(ctx.store, input.message, input.version)
  }));

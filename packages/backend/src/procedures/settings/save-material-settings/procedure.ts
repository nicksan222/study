import { writeMaterialSettings } from '#backend/procedures/settings/operations/save-material-settings';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    writeMaterialSettings(ctx.store, input.sift);

    return {};
  });

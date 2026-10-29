import { recording, recordingView } from '#server/procedures/recordings/operations/recording';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const found = recording(ctx.store, input.id);

    return { value: found ? recordingView(ctx.store, found) : null };
  });

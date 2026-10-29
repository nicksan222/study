import { appendRecording } from '#server/procedures/recordings/operations/append-recording';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    appendRecording(ctx.store, input.id, Int16Array.from(input.samples));

    return {};
  });

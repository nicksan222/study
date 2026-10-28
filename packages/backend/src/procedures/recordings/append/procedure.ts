import { appendRecording } from '#backend/procedures/recordings/operations/append-recording';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    appendRecording(ctx.store, input.id, Int16Array.from(input.samples));

    return {};
  });

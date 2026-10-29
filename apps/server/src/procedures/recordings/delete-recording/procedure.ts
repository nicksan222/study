import { deleteRecording } from '#server/procedures/recordings/operations/delete-recording';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: deleteRecording(ctx.store, input.id) }));

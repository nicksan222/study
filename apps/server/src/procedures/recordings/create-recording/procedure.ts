import { createRecording } from '#server/procedures/recordings/operations/create-recording';
import { recordingView } from '#server/procedures/recordings/operations/recording';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => recordingView(ctx.store, createRecording(ctx.store, input.id)));

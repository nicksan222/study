import { recordingView } from '#server/procedures/recordings/operations/recording';
import { listRecordings } from '#server/procedures/recordings/operations/recordings';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => ({
    items: listRecordings(ctx.store).map((value) => recordingView(ctx.store, value))
  }));

import { recordingView } from '#backend/procedures/recordings/operations/recording';
import { listRecordings } from '#backend/procedures/recordings/operations/recordings';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => ({
    items: listRecordings(ctx.store).map((value) => recordingView(ctx.store, value))
  }));

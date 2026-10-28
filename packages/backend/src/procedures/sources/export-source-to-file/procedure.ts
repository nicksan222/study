import { exportSource } from '#backend/procedures/sources/operations/export-source-to-file';
import { source } from '#backend/procedures/sources/operations/source';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    if (!input.destination || input.destination.length > 32768) invalid('Invalid destination');

    exportSource(ctx.store, input.sourceId, input.destination);

    return { value: source(ctx.store, input.sourceId)!.sizeBytes };
  });

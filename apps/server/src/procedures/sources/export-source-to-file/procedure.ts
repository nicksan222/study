import { exportSource } from '#server/procedures/sources/operations/export-source-to-file';
import { source } from '#server/procedures/sources/operations/source';
import { invalid } from '#server/runtime/errors';
import { publicProcedure } from '#server/runtime/trpc';

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

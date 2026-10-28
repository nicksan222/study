import { Schema } from 'effect';

import { sourceMaterial } from '#backend/procedures/ingestion/source-material';
import { enqueueJob } from '#backend/procedures/jobs/worker';
import { storeSource } from '#backend/procedures/sources/operations/upload-source';
import { publicProcedure } from '#backend/runtime/trpc';
import { sniff } from '#backend/shared/sources/sniff';

import { inputValidator } from './input.ts';
import { outputSchema, outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const material = ctx.store.transaction(() => {
      const source = storeSource(
        ctx.store,
        {
          name: input.name,
          bytes: input.bytes,
          ...sniff(input.name, input.bytes.subarray(0, 8192)),
          origin: 'import',
          projectId: input.projectId
        },
        input
      );

      enqueueJob(ctx.store, {
        kind: source.kind === 'link' ? 'fetch' : 'extract',
        target: { type: 'source', id: source.id }
      });

      return sourceMaterial(ctx.store, source, input)!;
    });

    ctx.wake();

    return Schema.decodeUnknownSync(outputSchema)(material);
  });

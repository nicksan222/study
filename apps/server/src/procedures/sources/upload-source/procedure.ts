import { enqueueJob } from '#server/procedures/jobs/worker';
import { storeSource } from '#server/procedures/sources/operations/upload-source';
import { invalid } from '#server/runtime/errors';
import { publicProcedure } from '#server/runtime/trpc';
import { sniff } from '#server/shared/sources/sniff';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    if (
      input.bytes.length > 16 * 1024 * 1024 ||
      !input.bytes.length ||
      !input.name.trim() ||
      input.name.length > 1024
    )
      invalid('Invalid upload');

    const source = ctx.store.transaction(() => {
      const value = storeSource(ctx.store, {
        name: input.name,
        bytes: input.bytes,
        ...sniff(input.name, input.bytes.subarray(0, 8192)),
        origin: 'import',
        projectId: input.project ?? null
      });

      enqueueJob(ctx.store, {
        kind: value.kind === 'link' ? 'fetch' : 'extract',
        target: { type: 'source', id: value.id }
      });

      return value;
    });

    ctx.wake();

    return source;
  });

import { enqueueJob } from '#backend/procedures/jobs/worker';
import { addLink } from '#backend/procedures/sources/operations/add-link';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    try {
      const url = new URL(input.url);

      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        invalid('Invalid link');
    } catch {
      invalid('Invalid link');
    }

    const source = ctx.store.transaction(() => {
      const value = addLink(ctx.store, input.project ?? null, input.url);

      enqueueJob(ctx.store, { kind: 'fetch', target: { type: 'source', id: value.id } });

      return value;
    });

    ctx.wake();

    return source;
  });

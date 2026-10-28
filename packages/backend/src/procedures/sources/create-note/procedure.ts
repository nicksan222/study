import { enqueueJob } from '#backend/procedures/jobs/worker';
import { createNote } from '#backend/procedures/sources/operations/create-note';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const source = ctx.store.transaction(() => {
      const value = createNote(ctx.store, input.title, input.text, input.project ?? null);

      enqueueJob(ctx.store, { kind: 'extract', target: { type: 'source', id: value.id } });

      return value;
    });

    ctx.wake();

    return source;
  });

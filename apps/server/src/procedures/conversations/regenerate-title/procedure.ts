import { session } from '#server/procedures/conversations/operations/session';
import { enqueueJob } from '#server/procedures/jobs/worker';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    if (!session(ctx.store, input.id)) throw new StudyError('not_found', 'Session missing');

    const id = enqueueJob(ctx.store, {
      kind: 'title',
      target: { type: 'session', id: input.id },
      args: { force: true }
    });

    ctx.wake();

    return { id };
  });

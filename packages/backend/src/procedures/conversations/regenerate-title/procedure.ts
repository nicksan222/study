import { session } from '#backend/procedures/conversations/operations/session';
import { enqueueJob } from '#backend/procedures/jobs/worker';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';

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

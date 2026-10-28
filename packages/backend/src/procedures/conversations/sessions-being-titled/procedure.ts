import { listJobs } from '#backend/procedures/jobs/operations/job-overviews';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => ({
    items: listJobs(ctx.store).flatMap((job) =>
      job.kind === 'title' &&
      job.target.type === 'session' &&
      ['blocked', 'queued', 'waiting', 'running'].includes(job.status)
        ? [job.target.id]
        : []
    )
  }));

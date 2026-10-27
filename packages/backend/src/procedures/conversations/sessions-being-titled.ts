import { z } from 'zod';

import { listJobs as opListJobs } from '#backend/procedures/jobs/job-overviews';
import { publicProcedure } from '#backend/runtime/trpc';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return {
    items: opListJobs(store).flatMap((j) =>
      j.kind === 'title' &&
      j.target.type === 'session' &&
      ['blocked', 'queued', 'waiting', 'running'].includes(j.status)
        ? [j.target.id]
        : []
    )
  };
});

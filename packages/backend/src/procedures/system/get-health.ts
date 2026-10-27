import { z } from 'zod';

import { listProjects as opListProjects } from '#backend/procedures/projects/projects';
import { publicProcedure } from '#backend/runtime/trpc';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store, workers } = context;

  opListProjects(store);

  return {
    protocolVersion: 1,
    workersRunning: workers.started,
    testMode: false
  };
});

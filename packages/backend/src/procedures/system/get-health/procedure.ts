import { listProjects } from '#backend/procedures/projects/operations/read-projects';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx }) => {
    const { store, workers } = ctx;

    listProjects(store);

    return {
      protocolVersion: 1,
      workersRunning: workers.started,
      testMode: false
    };
  });

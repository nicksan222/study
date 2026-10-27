import { router } from '#backend/runtime/trpc';

import { run as getHealth } from './get-health.ts';
import { run as search } from './search.ts';
import { run as startWorkers } from './start-workers.ts';
import { run as subscribe } from './subscribe.ts';

export const systemRouter = router({
  getHealth,
  search,
  startWorkers,
  subscribe
});

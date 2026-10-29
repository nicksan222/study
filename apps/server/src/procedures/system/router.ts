import { router } from '#server/runtime/trpc';

import { run as getHealth } from './get-health/index.ts';
import { run as search } from './search/index.ts';
import { run as startWorkers } from './start-workers/index.ts';
import { run as subscribe } from './subscribe/index.ts';

export const systemRouter = router({
  getHealth,
  search,
  startWorkers,
  subscribe
});

import { router } from '#server/runtime/trpc';

import { run as cancelJob } from './cancel-job/index.ts';
import { run as jobOverviews } from './job-overviews/index.ts';
import { run as job } from './job/index.ts';
import { run as retryJob } from './retry-job/index.ts';

export const jobsRouter = router({ jobOverviews, job, cancelJob, retryJob });

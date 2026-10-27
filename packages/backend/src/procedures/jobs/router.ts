import { router } from '#backend/runtime/trpc';

import { run as cancelJob } from './cancel-job.ts';
import { run as jobOverviews } from './job-overviews.ts';
import { run as job } from './job.ts';
import { run as retryJob } from './retry-job.ts';

export const jobsRouter = router({ jobOverviews, job, cancelJob, retryJob });

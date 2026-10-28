import { router } from '#backend/runtime/trpc';

import { run as addLink } from './add-link/index.ts';
import { run as uploadFile } from './upload-file/index.ts';

export const ingestionRouter = router({ uploadFile, addLink });

import { router } from '#server/runtime/trpc';

import { run as append } from './append/index.ts';
import { run as createRecording } from './create-recording/index.ts';
import { run as deleteRecording } from './delete-recording/index.ts';
import { run as postRecording } from './post-recording/index.ts';
import { run as recording } from './recording/index.ts';
import { run as recordings } from './recordings/index.ts';

export const recordingsRouter = router({
  recordings,
  recording,
  createRecording,
  append,
  deleteRecording,
  postRecording
});

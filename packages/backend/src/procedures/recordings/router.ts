import { router } from '#backend/runtime/trpc';

import { run as append } from './append-recording.ts';
import { run as createRecording } from './create-recording.ts';
import { run as deleteRecording } from './delete-recording.ts';
import { run as postRecording } from './post-recording.ts';
import { run as recording } from './recording.ts';
import { run as recordings } from './recordings.ts';

export const recordingsRouter = router({
  recordings,
  recording,
  createRecording,
  append,
  deleteRecording,
  postRecording
});

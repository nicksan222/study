import { authRouter } from '#server/procedures/auth/router';
import { conversationsRouter } from '#server/procedures/conversations/router';
import { ingestionRouter } from '#server/procedures/ingestion/router';
import { jobsRouter } from '#server/procedures/jobs/router';
import { learningRouter } from '#server/procedures/learning/router';
import { materialRouter } from '#server/procedures/material/router';
import { materialsRouter } from '#server/procedures/materials/router';
import { practiceRouter } from '#server/procedures/practice/router';
import { projectsRouter } from '#server/procedures/projects/router';
import { recordingsRouter } from '#server/procedures/recordings/router';
import { settingsRouter } from '#server/procedures/settings/router';
import { sourcesRouter } from '#server/procedures/sources/router';
import { systemRouter } from '#server/procedures/system/router';
import { themesRouter } from '#server/procedures/themes/router';

import { router } from './trpc.ts';

export const appRouter = router({
  themes: themesRouter,
  projects: projectsRouter,
  sources: sourcesRouter,
  conversations: conversationsRouter,
  recordings: recordingsRouter,
  material: materialRouter,
  materials: materialsRouter,
  learning: learningRouter,
  ingestion: ingestionRouter,
  practice: practiceRouter,
  jobs: jobsRouter,
  settings: settingsRouter,
  auth: authRouter,
  system: systemRouter
});

export type AppRouter = typeof appRouter;

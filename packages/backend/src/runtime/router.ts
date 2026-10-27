import { authRouter } from '#backend/procedures/auth/router';
import { conversationsRouter } from '#backend/procedures/conversations/router';
import { ingestionRouter } from '#backend/procedures/ingestion/router';
import { jobsRouter } from '#backend/procedures/jobs/router';
import { learningRouter } from '#backend/procedures/learning/router';
import { materialRouter } from '#backend/procedures/material/router';
import { materialsRouter } from '#backend/procedures/materials/router';
import { practiceRouter } from '#backend/procedures/practice/router';
import { projectsRouter } from '#backend/procedures/projects/router';
import { recordingsRouter } from '#backend/procedures/recordings/router';
import { settingsRouter } from '#backend/procedures/settings/router';
import { sourcesRouter } from '#backend/procedures/sources/router';
import { systemRouter } from '#backend/procedures/system/router';

import { router } from './trpc.ts';

export const appRouter = router({
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

import { router } from '#server/runtime/trpc';

import { run as createProject } from './create-project/index.ts';
import { run as deleteProject } from './delete-project/index.ts';
import { run as projects } from './projects/index.ts';
import { run as renameProject } from './rename-project/index.ts';
import { run as setExam } from './set-exam/index.ts';

export const projectsRouter = router({
  projects,
  createProject,
  renameProject,
  setExam,
  deleteProject
});

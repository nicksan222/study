import { router } from '#backend/runtime/trpc';

import { run as createProject } from './create-project.ts';
import { run as deleteProject } from './delete-project.ts';
import { run as projects } from './projects.ts';
import { run as renameProject } from './rename-project.ts';
import { run as setExam } from './set-exam.ts';

export const projectsRouter = router({
  projects,
  createProject,
  renameProject,
  setExam,
  deleteProject
});

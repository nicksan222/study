import { ProjectsRpc } from '@study/contracts/projects/rpc';
import { Effect } from 'effect';

import { Projects } from '#server/features/projects/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const ProjectsRpcLive = defineRpc(
  ProjectsRpc,
  Effect.gen(function* () {
    const projects = yield* Projects;

    return {
      'projects.project': ({ id }) => projects.project(id),
      'projects.findProject': ({ id }) => projects.findProject(id),
      'projects.projects': (input) => projects.projects(input),
      'projects.createProject': (input) => projects.createProject(input),
      'projects.renameProject': (input) => projects.renameProject(input),
      'projects.deleteProject': (input) => projects.deleteProject(input),
      'projects.setExam': (input) => projects.setExam(input)
    };
  })
);

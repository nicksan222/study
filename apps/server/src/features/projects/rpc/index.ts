import type { StudyError } from '@study/contracts/errors';
import { ProjectsRpc } from '@study/contracts/projects/rpc';
import { Effect } from 'effect';

import { Projects } from '#server/features/projects/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const ProjectsRpcLive = ProjectsRpc.toLayer(
  Effect.gen(function* () {
    const projects = yield* Projects;

    return {
      'projects.project': ({ id }) => projects.project(id).pipe(Effect.mapError(failure)),
      'projects.findProject': ({ id }) => projects.findProject(id).pipe(Effect.mapError(failure)),
      'projects.projects': (input) => projects.projects(input).pipe(Effect.mapError(failure)),
      'projects.createProject': (input) =>
        projects.createProject(input).pipe(Effect.mapError(failure)),
      'projects.renameProject': (input) =>
        projects.renameProject(input).pipe(Effect.mapError(failure)),
      'projects.deleteProject': (input) =>
        projects.deleteProject(input).pipe(Effect.mapError(failure)),
      'projects.setExam': (input) => projects.setExam(input).pipe(Effect.mapError(failure))
    };
  })
);

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds the public project RPC group to the project service without adding domain    │
 * │ behavior.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - RPC handlers adapt declared schemas to the owning feature service; transport wiring    │
 * │   stays here.                                                                            │
 * │ - Maps declared operations to the feature service.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Leaves input validation and domain behavior to contracts and service.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { ProjectsRpc } from '@study/contracts/projects/rpc';
import { Effect } from 'effect';

import { Projects } from '#server/features/projects/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const ProjectsRpcLive = defineRpc(
  ProjectsRpc,
  Effect.gen(function* () {
    const projects = yield* Projects;

    return {
      'projects.addMaterial': (input) => projects.addMaterial(input),
      'projects.removeMaterial': (input) => projects.removeMaterial(input),
      'projects.addNote': (input) => projects.addNote(input),
      'projects.removeNote': (input) => projects.removeNote(input),
      'projects.project': ({ id }) => projects.project(id),
      'projects.findProject': ({ id }) => projects.findProject(id),
      'projects.projects': (input) => projects.projects(input),
      'projects.createProject': (input) => projects.createProject(input),
      'projects.renameProject': (input) => projects.renameProject(input),
      'projects.deleteProject': (input) => projects.deleteProject(input),
      'projects.setIcon': (input) => projects.setIcon(input),
      'projects.setExam': (input) => projects.setExam(input)
    };
  })
);

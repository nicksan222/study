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

import { Projects } from '#server/features/projects/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const ProjectsRpcLive = defineRpc(ProjectsRpc, { projects: Projects }, ({ projects }) => ({
  'projects.addMaterial': projects.addMaterial,
  'projects.removeMaterial': projects.removeMaterial,
  'projects.addNote': projects.addNote,
  'projects.removeNote': projects.removeNote,
  'projects.project': ({ id }) => projects.project(id),
  'projects.findProject': ({ id }) => projects.findProject(id),
  'projects.projects': projects.projects,
  'projects.createProject': projects.createProject,
  'projects.renameProject': projects.renameProject,
  'projects.deleteProject': projects.deleteProject,
  'projects.setIcon': projects.setIcon,
  'projects.setExam': projects.setExam
}));

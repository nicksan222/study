/** @file Composes projects persistence with canonical typed store declarations. */

import { defineStore } from '#server/platform/definitions/define-store';

import { makeProjectsStore } from './projects.ts';

export const ProjectsStore = defineStore({
  name: 'study/ProjectsStore',
  entity: { singular: 'project', plural: 'projects' },
  make: (resources) => makeProjectsStore(resources)
});

/** @file Composes system persistence with canonical typed store declarations. */

import { defineStore } from '#server/platform/definitions/define-store';

import { makeHealthStore } from './health.ts';
import { makeSystemStore } from './search.ts';

export const HealthStore = defineStore({
  name: 'study/SystemHealthStore',
  entity: { singular: 'health', plural: 'healths' },
  make: (resources) => makeHealthStore(resources)
});

export const SystemStore = defineStore({
  name: 'study/SystemStore',
  entity: { singular: 'search', plural: 'searches' },
  make: (resources) => makeSystemStore(resources)
});

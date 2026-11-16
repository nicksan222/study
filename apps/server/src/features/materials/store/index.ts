/** @file Composes materials persistence with canonical typed store declarations. */

import { defineStore } from '#server/platform/definitions/define-store';

import { makeMaterialCitationsStore } from './citations.ts';
import { makeMaterialActiveGenerationsStore, makeMaterialGenerationStore } from './generation.ts';
import { makeMaterialsStore } from './library.ts';
import { makeMaterialVersionsStore } from './versions.ts';

export const MaterialCitationsStore = defineStore({
  name: 'study/MaterialCitationsStore',
  entity: { singular: 'citation', plural: 'citations' },
  make: (resources) => makeMaterialCitationsStore(resources)
});

export const MaterialActiveGenerationsStore = defineStore({
  name: 'study/MaterialActiveGenerationsStore',
  entity: { singular: 'activeGenerations', plural: 'activeGenerationBatches' },
  make: (resources) => makeMaterialActiveGenerationsStore(resources)
});

export const MaterialGenerationStore = defineStore({
  name: 'study/MaterialGenerationStore',
  entity: { singular: 'materialGeneration', plural: 'materialGenerations' },
  make: (resources) => makeMaterialGenerationStore(resources)
});

export const MaterialsStore = defineStore({
  name: 'study/MaterialsStore',
  entity: { singular: 'material', plural: 'materials' },
  make: (resources) => makeMaterialsStore(resources)
});

export const MaterialVersionsStore = defineStore({
  name: 'study/MaterialVersionsStore',
  entity: { singular: 'materialVersion', plural: 'materialVersions' },
  make: (resources) => makeMaterialVersionsStore(resources)
});

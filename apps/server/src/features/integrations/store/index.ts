/** @file Composes integrations persistence with canonical typed store declarations. */

import { defineStore } from '@study/server';

import { makeIntegrationImportsStore } from './imports.ts';

export const IntegrationImportsStore = defineStore({
  name: 'study/IntegrationImportsStore',
  entity: { singular: 'integrationImport', plural: 'integrationImports' },
  make: (resources) => makeIntegrationImportsStore(resources)
});

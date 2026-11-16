/** @file Composes workflows persistence with canonical typed store declarations. */

import { defineStore } from '@study/server';

import { makeExecutionStore } from './executions.ts';

export const ExecutionStore = defineStore({
  name: 'study/ExecutionStore',
  entity: { singular: 'execution', plural: 'executions' },
  make: (resources) => makeExecutionStore(resources)
});

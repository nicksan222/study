import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRulePaths } from '../test/utils.ts';

async function lint(files: Record<string, string>) {
  const sources = Object.fromEntries(
    Object.entries(files).map(([path, source]) => [`apps/server/src/features/${path}`, source])
  );

  return (await lintRulePaths('module-factories', sources)).map((path) =>
    path.slice('apps/server/src/features/'.length)
  );
}

testStable('only canonical factory results and their service layers are public', async () => {
  expect(
    await lint({
      'alpha/service/index.ts':
        "import { defineService as create } from '#server/platform/definitions/define-service'; const alias = create; function helper() {} const service = alias('study/Alpha', make); export { service as Alpha }; export const layer = service.layer;",
      'beta/index.ts':
        "import * as api from '#server/platform/definitions/define-service'; const alias = api; export const Beta = alias.defineService('study/Beta', make); export { BetaStore } from './store.ts';",
      'gamma/store/index.ts':
        "import { defineStore as store } from '#server/platform/definitions/define-store'; export default store({make: ({db}) => ({queries: {}, mutations: {}})});",
      'delta/store/index.ts': 'export function query() {}',
      'epsilon/index.ts': "export { query } from './store/query.ts';",
      'zeta/store/index.ts': 'const one = two; const two = one; export { one };',
      'eta/store/query.ts': 'export function query() {}',
      'theta/service/index.ts':
        "import { defineService } from '#server/platform/definitions/define-service'; function make(defineService) { return defineService('study/Theta', x); } export const Theta = make(fake);",
      'iota/store/index.ts':
        "import { defineStore } from '#server/platform/definitions/define-store'; export const Store = defineStore({make: ({db}) => ({queries: {}, mutations: {}})}); export const bad = () => 1;",
      'kappa/index.ts': "export * from './store/queries.ts';",
      'lambda/index.ts': "export { type Input } from './store/query.ts';"
    })
  ).toStrictEqual([
    'beta/index.ts',
    'delta/store/index.ts',
    'epsilon/index.ts',
    'iota/store/index.ts',
    'kappa/index.ts',
    'theta/service/index.ts',
    'zeta/store/index.ts'
  ]);
});

testStable(
  'store entry requires an exported factory even when it contains only private helpers',
  async () => {
    expect(
      await lint({
        'alpha/store/index.ts': 'function helper() { return 1; }',
        'beta/store/index.ts': 'export type Input = string;',
        'gamma/store/query.ts': 'function helper() { return 1; }'
      })
    ).toStrictEqual(['alpha/store/index.ts', 'beta/store/index.ts']);
  }
);

testStable('nested entry modules cannot avoid canonical construction', async () => {
  expect(
    await lint({
      'sources/nested/store.ts': 'export const db = {};',
      'sources/nested/service.ts': 'export const Sources = {};'
    })
  ).toStrictEqual(['sources/nested/service.ts', 'sources/nested/store.ts']);
});

testStable(
  'snapshot participants stay attached to the canonical service rather than detached public helpers',
  async () => {
    expect(
      await lint({
        'auth/service/index.ts':
          "import { defineService } from '#server/platform/definitions/define-service'; export const Auth = defineService('study/Auth', make, {sanitizeBackup: tx => tx.store(Store).sanitize(undefined)});",
        'sources/service/index.ts':
          "import { defineService } from '#server/platform/definitions/define-service'; export const Sources = defineService('study/Sources', make); export const validateBackup = tx => tx.store(Store).validate(undefined);"
      })
    ).toStrictEqual(['sources/service/index.ts']);
  }
);

testStable('native generator functions must still be registered workflow handlers', async () => {
  expect(
    await lintRulePaths('module-factories', {
      'apps/server/src/features/notes/workflows/good.ts':
        "import {Effect as E} from 'effect'; import {defineWorkflowHandler as register} from '#server/platform/definitions/define-workflow-handler'; export const run = E.fnUntraced(function* () { yield* work; }); export const registration = register(workflow, {execute: run, triggers: []});",
      'apps/server/src/features/notes/workflows/bad.ts':
        "import {Effect as E} from 'effect'; export const run = E.fnUntraced(function* () { yield* work; });"
    })
  ).toStrictEqual(['apps/server/src/features/notes/workflows/bad.ts']);
});

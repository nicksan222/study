import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRulePaths } from '../test/utils.ts';

function lint(files: Record<string, string>) {
  return lintRulePaths('operation-conventions', files);
}

test('checks literal store roles, names and collection input and service public reads', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/a/store/index.ts': `import { Schema as S } from 'effect'; import { defineStore as create, storeQuery as query } from '#server/platform/definitions/define-store'; const f = create; export const A = f({ entity: { singular: 'item', plural: 'items' }, make: ({db}) => ({queries: { getItem: query({role:'required', input: S.String}), items: query({role:'collection', input: S.Struct({})}) }, mutations: {}}) });`,
      'apps/server/src/features/b/store/index.ts': `import * as api from '#server/platform/definitions/define-store'; export const B = api.defineStore({ entity: { singular:'item', plural:'items' }, make: ({db}) => ({queries: { item: api.storeQuery({role:'required'}), findItem: api.storeQuery({role:'optional'}), items: api.storeQuery({role:'collection', input: S.Struct({limit:S.Int})}) }, mutations:{}}) });`,
      'apps/server/src/features/c/service/index.ts': `import { defineService as create } from '#server/platform/definitions/define-service'; import { Effect } from 'effect'; const getLocal = () => 1; export const C = create('C', Effect.gen(function* () { return { getItem: () => x, saveItem: () => x }; }));`,
      'apps/server/src/features/f/store/index.ts': `import { Schema as S } from 'effect'; import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({entity: {singular:'item', plural:'items'}, make: ({db}) => ({queries:{items: storeQuery({role:'collection', input:S.Struct({limit:S.String})})}, mutations:{}})});`,
      'apps/server/src/features/e/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({entity: {singular:'item', plural:'items'}, make: ({db}) => ({queries:{item: storeQuery({input:S.String})}, mutations:{}})});`,
      'apps/server/src/features/d/service/index.ts': `import { defineService } from '#server/platform/definitions/define-service'; function f(defineService) { return defineService('x', {getItem(){}}); }`
    }),
    [
      'apps/server/src/features/a/store/index.ts',
      'apps/server/src/features/a/store/index.ts',
      'apps/server/src/features/c/service/index.ts',
      'apps/server/src/features/e/store/index.ts',
      'apps/server/src/features/f/store/index.ts'
    ]
  );
});

test('schema field composition relies on runtime bounds when the imported shape is opaque', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/learning/store/index.ts': `import { Schema } from 'effect'; import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; import { pageInput } from '@study/contracts/learning/rpc'; defineStore({ entity: {singular:'card', plural:'cards'}, make: ({db}) => ({ queries: { cards: storeQuery({role:'collection',input:Schema.Struct({...pageInput.fields, newCardsPerDay:Schema.Int}), run: input => input}) }, mutations: {} }) });`
    }),
    []
  );
});

test('checks queries returned by a store make callback', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/items/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({ entity: { singular: 'item', plural: 'items' }, make: ({db}) => ({ queries: { getItem: storeQuery({ role: 'required' }) }, mutations: {} }) });`
    }),
    ['apps/server/src/features/items/store/index.ts']
  );
});

test('native generation queries retain entity-derived names and canonical required roles', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/materials/store/index.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({
          entity: { singular: 'materialGeneration', plural: 'materialGenerations' },
          make: () => ({
            queries: { materialGeneration: storeQuery({ role: 'required' }) },
            mutations: {}
          })
        });
      `,
      'apps/server/src/features/materials/store/alias.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({
          entity: { singular: 'materialGeneration', plural: 'materialGenerations' },
          make: () => ({
            queries: { readGeneration: storeQuery({ role: 'required' }) },
            mutations: {}
          })
        });
      `,
      'apps/server/src/features/conversations/store/role.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({
          entity: { singular: 'sessionContext', plural: 'sessionContexts' },
          make: () => ({
            queries: { sessionContext: storeQuery({ role: 'snapshot' }) },
            mutations: {}
          })
        });
      `
    }),
    [
      'apps/server/src/features/conversations/store/role.ts',
      'apps/server/src/features/materials/store/alias.ts'
    ]
  );
});

test('proposal, receipt, comparison and context-validity stores use their own canonical descriptors', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/materials/store/proposals.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'documentProposal',plural:'documentProposals'},make:()=>({queries:{documentProposal:storeQuery({role:'required'})},mutations:{}})});
      defineStore({entity:{singular:'documentProposalReceipt',plural:'documentProposalReceipts'},make:()=>({queries:{findDocumentProposalReceipt:storeQuery({role:'optional'})},mutations:{}})});
      defineStore({entity:{singular:'documentComparison',plural:'documentComparisons'},make:()=>({queries:{documentComparison:storeQuery({role:'required'})},mutations:{}})});
    `,
      'apps/server/src/features/conversations/store/validity.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'sessionContextValidity',plural:'sessionContextValidities'},make:()=>({queries:{sessionContextValidity:storeQuery({role:'required'})},mutations:{}})});
    `,
      'apps/server/src/features/materials/store/bypass.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'documentProposal',plural:'documentProposals'},make:()=>({queries:{findDocumentProposalReceipt:storeQuery({role:'optional'}),compare:storeQuery({role:'required'})},mutations:{}})});
    `
    }),
    [
      'apps/server/src/features/materials/store/bypass.ts',
      'apps/server/src/features/materials/store/bypass.ts'
    ]
  );
});

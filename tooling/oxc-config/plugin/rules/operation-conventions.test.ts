import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';

import { lintRulePaths } from '../test/utils.ts';

function lint(files: Record<string, string>) {
  return lintRulePaths('operation-conventions', files);
}

testStable(
  'checks literal store roles, names and collection input and service public reads',
  () => {
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
  }
);

testStable(
  'schema field composition relies on runtime bounds when the imported shape is opaque',
  () => {
    assert.deepEqual(
      lint({
        'apps/server/src/features/learning/store/index.ts': `import { Schema } from 'effect'; import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; import { pageInput } from '@study/contracts/learning/rpc'; defineStore({ entity: {singular:'card', plural:'cards'}, make: ({db}) => ({ queries: { cards: storeQuery({role:'collection',input:Schema.Struct({...pageInput.fields, newCardsPerDay:Schema.Int}), run: input => input}) }, mutations: {} }) });`
      }),
      []
    );
  }
);

testStable('checks queries returned by a store make callback', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/items/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({ entity: { singular: 'item', plural: 'items' }, make: ({db}) => ({ queries: { getItem: storeQuery({ role: 'required' }) }, mutations: {} }) });`
    }),
    ['apps/server/src/features/items/store/index.ts']
  );
});

testStable(
  'native generation queries retain entity-derived names and canonical required roles',
  () => {
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
  }
);

testStable(
  'proposal, receipt, comparison and context-validity stores use their own canonical descriptors',
  () => {
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
  }
);

testStable('deletion aggregates require their own canonical descriptors beside status', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/conversations/store/deletion.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'sessionDeletion',plural:'sessionDeletions'},make:()=>({queries:{sessionDeletion:storeQuery({role:'required'}),findSessionDeletion:storeQuery({role:'optional'})},mutations:{}})});
      defineStore({entity:{singular:'deletionOwnership',plural:'deletionOwnerships'},make:()=>({queries:{deletionOwnership:storeQuery({role:'required'})},mutations:{}})});
      defineStore({entity:{singular:'deletionCorrelation',plural:'deletionCorrelations'},make:()=>({queries:{deletionCorrelation:storeQuery({role:'required'})},mutations:{}})});
    `,
      'apps/server/src/features/conversations/store/bypass.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'sessionDeletion',plural:'sessionDeletions'},make:()=>({queries:{deletionOwnership:storeQuery({role:'required'}),deletionCorrelations:storeQuery({role:'required'})},mutations:{}})});
    `
    }),
    Array(2).fill('apps/server/src/features/conversations/store/bypass.ts')
  );
});

testStable(
  'Material deletion status, preview and participants bind their own canonical store query names',
  () => {
    assert.deepEqual(
      lint({
        'apps/server/src/features/materials/store/deletion.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'materialDeletion',plural:'materialDeletions'},make:()=>({queries:{materialDeletion:storeQuery({role:'required'}),findMaterialDeletion:storeQuery({role:'optional'})},mutations:{}})});
      defineStore({entity:{singular:'materialDeletionPreview',plural:'materialDeletionPreviews'},make:()=>({queries:{materialDeletionPreview:storeQuery({role:'required'})},mutations:{}})});
      defineStore({entity:{singular:'materialDeletionOwnership',plural:'materialDeletionOwnerships'},make:()=>({queries:{materialDeletionOwnership:storeQuery({role:'required'})},mutations:{}})});
    `,
        'apps/server/src/features/sources/store/material-deletion.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'sourceMaterialImpact',plural:'sourceMaterialImpacts'},make:()=>({queries:{sourceMaterialImpact:storeQuery({role:'required'})},mutations:{}})});
    `,
        'apps/server/src/features/materials/store/bypass.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'materialDeletion',plural:'materialDeletions'},make:()=>({queries:{readStatus:storeQuery({role:'required'}),previewDeletion:storeQuery({role:'optional'})},mutations:{}})});
    `
      }),
      Array(2).fill('apps/server/src/features/materials/store/bypass.ts')
    );
  }
);

testStable(
  'history status, preview, publication and source impact keep canonical singular descriptors',
  () => {
    assert.deepEqual(
      lint({
        'apps/server/src/features/materials/store/history.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'materialHistory',plural:'materialHistories'},make:()=>({queries:{materialHistory:storeQuery({role:'required'}),findMaterialHistory:storeQuery({role:'optional'})},mutations:{}})});

      defineStore({entity:{singular:'materialHistoryPublication',plural:'materialHistoryPublications'},make:()=>({queries:{materialHistoryPublication:storeQuery({role:'required'})},mutations:{}})});

    `,
        'apps/server/src/features/sources/store/history.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'sourceMaterialHistory',plural:'sourceMaterialHistories'},make:()=>({queries:{sourceMaterialHistory:storeQuery({role:'required'})},mutations:{}})});

    `,
        'apps/server/src/features/materials/store/unsafe-history.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'materialHistory',plural:'materialHistories'},make:()=>({queries:{readStatus:storeQuery({role:'required'}),findMaterialHistory:storeQuery({role:'required'})},mutations:{}})});

    `
      }),
      Array(2).fill('apps/server/src/features/materials/store/unsafe-history.ts')
    );
  }
);

testStable(
  'exact readers and reply provenance bind required queries to separate singular entities',
  () => {
    assert.deepEqual(
      lint({
        'apps/server/src/features/materials/store/reader.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'materialVersionDocument',plural:'materialVersionDocuments'},make:()=>({queries:{materialVersionDocument:storeQuery({role:'required'})},mutations:{}})});
        defineStore({entity:{singular:'materialVersionImage',plural:'materialVersionImages'},make:()=>({queries:{materialVersionImage:storeQuery({role:'required'})},mutations:{}})});
        defineStore({entity:{singular:'importedMaterial',plural:'importedMaterials'},make:()=>({queries:{importedMaterial:storeQuery({role:'required'})},mutations:{}})});
      `,
        'apps/server/src/features/conversations/store/reply.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'replyVersion',plural:'replyVersions'},make:()=>({queries:{replyVersion:storeQuery({role:'required'})},mutations:{}})});
        defineStore({entity:{singular:'replyRequest',plural:'replyRequests'},make:()=>({queries:{findReplyRequest:storeQuery({role:'optional'})},mutations:{}})});
      `,
        'apps/server/src/features/materials/store/combined.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'materialReader',plural:'materialReaders'},make:()=>({queries:{materialVersionDocument:storeQuery({role:'required'}),materialVersionImage:storeQuery({role:'required'}),importedMaterial:storeQuery({role:'required'})},mutations:{}})});
      `,
        'apps/server/src/features/conversations/store/combined.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'replyRequest',plural:'replyRequests'},make:()=>({queries:{findReplyRequest:storeQuery({role:'optional'}),replyVersion:storeQuery({role:'required'})},mutations:{}})});
      `
      }),
      [
        'apps/server/src/features/conversations/store/combined.ts',
        ...Array(3).fill('apps/server/src/features/materials/store/combined.ts')
      ]
    );
  }
);

testStable(
  'export aggregates use required singular descriptors while collections still require limits',
  () => {
    assert.deepEqual(
      lint({
        'apps/server/src/features/materials/store/export.ts': `
        import { Schema } from 'effect';
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'exportInputGraph',plural:'exportInputGraphs'},make:()=>({queries:{exportInputGraph:storeQuery({role:'required',input:Schema.Struct({id:Schema.BigInt}),output:Schema.Struct({ids:Schema.Array(Schema.BigInt)})})},mutations:{}})});
        defineStore({entity:{singular:'exportCitationSnapshot',plural:'exportCitationSnapshots'},make:()=>({queries:{exportCitationSnapshot:storeQuery({role:'required',input:Schema.Struct({id:Schema.BigInt,budget:Schema.Int}),output:Schema.Struct({citations:Schema.Array(Schema.Unknown)})})},mutations:{}})});
      `,
        'apps/server/src/features/materials/store/unbounded-export.ts': `
        import { Schema } from 'effect';
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'exportCitation',plural:'exportCitations'},make:()=>({queries:{exportCitations:storeQuery({role:'collection',input:Schema.Struct({id:Schema.BigInt,budget:Schema.Int})})},mutations:{}})});
      `,
        'apps/server/src/features/materials/store/export-alias.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'exportInputGraph',plural:'exportInputGraphs'},make:()=>({queries:{exportInputs:storeQuery({role:'required'})},mutations:{}})});
      `
      }),
      [
        'apps/server/src/features/materials/store/export-alias.ts',
        'apps/server/src/features/materials/store/unbounded-export.ts'
      ]
    );
  }
);

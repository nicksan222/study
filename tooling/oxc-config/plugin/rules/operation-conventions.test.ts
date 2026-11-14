import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRulePaths } from '../test/utils.ts';

async function lint(files: Record<string, string>) {
  return await lintRulePaths('operation-conventions', files);
}

testStable('checks literal store roles, collection input and service public reads', async () => {
  expect(
    await lint({
      'apps/server/src/features/a/store/index.ts': `import { Schema as S } from 'effect'; import { defineStore as create, storeQuery as query } from '#server/platform/definitions/define-store'; const f = create; export const A = f({ entity: { singular: 'item', plural: 'items' }, make: ({db}) => ({queries: { getItem: query({role:'required', input: S.String}), items: query({role:'collection', input: S.Struct({})}) }, mutations: {}}) });`,
      'apps/server/src/features/b/store/index.ts': `import * as api from '#server/platform/definitions/define-store'; export const B = api.defineStore({ entity: { singular:'item', plural:'items' }, make: ({db}) => ({queries: { item: api.storeQuery({role:'required'}), findItem: api.storeQuery({role:'optional'}), items: api.storeQuery({role:'collection', input: S.Struct({limit:S.Int})}) }, mutations:{}}) });`,
      'apps/server/src/features/c/service/index.ts': `import { defineService as create } from '#server/platform/definitions/define-service'; import { Effect } from 'effect'; const getLocal = () => 1; export const C = create('C', Effect.gen(function* () { return { getItem: () => x, saveItem: () => x }; }));`,
      'apps/server/src/features/f/store/index.ts': `import { Schema as S } from 'effect'; import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({entity: {singular:'item', plural:'items'}, make: ({db}) => ({queries:{items: storeQuery({role:'collection', input:S.Struct({limit:S.String})})}, mutations:{}})});`,
      'apps/server/src/features/e/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({entity: {singular:'item', plural:'items'}, make: ({db}) => ({queries:{item: storeQuery({input:S.String})}, mutations:{}})});`,
      'apps/server/src/features/d/service/index.ts': `import { defineService } from '#server/platform/definitions/define-service'; function f(defineService) { return defineService('x', {getItem(){}}); }`
    })
  ).toStrictEqual([
    'apps/server/src/features/a/store/index.ts',
    'apps/server/src/features/c/service/index.ts',
    'apps/server/src/features/e/store/index.ts',
    'apps/server/src/features/f/store/index.ts'
  ]);
});

testStable(
  'schema field composition relies on runtime bounds when the imported shape is opaque',
  async () => {
    expect(
      await lint({
        'apps/server/src/features/learning/store/index.ts': `import { Schema } from 'effect'; import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; import { pageInput } from '@study/contracts/learning/rpc'; defineStore({ entity: {singular:'card', plural:'cards'}, make: ({db}) => ({ queries: { cards: storeQuery({role:'collection',input:Schema.Struct({...pageInput.fields, newCardsPerDay:Schema.Int}), run: input => input}) }, mutations: {} }) });`
      })
    ).toStrictEqual([]);
  }
);

testStable('checks queries returned by a store make callback', async () => {
  expect(
    await lint({
      'apps/server/src/features/items/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({ entity: { singular: 'item', plural: 'items' }, make: ({db}) => ({ queries: { getItem: storeQuery({ role: 'snapshot' }) }, mutations: {} }) });`
    })
  ).toStrictEqual(['apps/server/src/features/items/store/index.ts']);
});

testStable(
  'generation queries allow descriptive names while retaining canonical roles',
  async () => {
    expect(
      await lint({
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
        'apps/server/src/features/notes/store/role.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({
          entity: { singular: 'noteContext', plural: 'noteContexts' },
          make: () => ({
            queries: { noteContext: storeQuery({ role: 'snapshot' }) },
            mutations: {}
          })
        });
      `
      })
    ).toStrictEqual(['apps/server/src/features/notes/store/role.ts']);
  }
);

testStable(
  'proposal, receipt, comparison and context-validity queries allow semantic names',
  async () => {
    expect(
      await lint({
        'apps/server/src/features/materials/store/proposals.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'documentProposal',plural:'documentProposals'},make:()=>({queries:{documentProposal:storeQuery({role:'required'})},mutations:{}})});
      defineStore({entity:{singular:'documentProposalReceipt',plural:'documentProposalReceipts'},make:()=>({queries:{findDocumentProposalReceipt:storeQuery({role:'optional'})},mutations:{}})});
      defineStore({entity:{singular:'documentComparison',plural:'documentComparisons'},make:()=>({queries:{documentComparison:storeQuery({role:'required'})},mutations:{}})});
    `,
        'apps/server/src/features/notes/store/validity.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'noteContextValidity',plural:'noteContextValidities'},make:()=>({queries:{noteContextValidity:storeQuery({role:'required'})},mutations:{}})});
    `,
        'apps/server/src/features/materials/store/descriptive.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'documentProposal',plural:'documentProposals'},make:()=>({queries:{findDocumentProposalReceipt:storeQuery({role:'optional'}),compare:storeQuery({role:'required'})},mutations:{}})});
    `
      })
    ).toStrictEqual([]);
  }
);

testStable('deletion queries can share the required role within one store', async () => {
  expect(
    await lint({
      'apps/server/src/features/notes/store/deletion.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'noteDeletion',plural:'noteDeletions'},make:()=>({queries:{noteDeletion:storeQuery({role:'required'}),findNoteDeletion:storeQuery({role:'optional'})},mutations:{}})});
      defineStore({entity:{singular:'deletionOwnership',plural:'deletionOwnerships'},make:()=>({queries:{deletionOwnership:storeQuery({role:'required'})},mutations:{}})});
      defineStore({entity:{singular:'deletionCorrelation',plural:'deletionCorrelations'},make:()=>({queries:{deletionCorrelation:storeQuery({role:'required'})},mutations:{}})});
    `,
      'apps/server/src/features/notes/store/descriptive.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'noteDeletion',plural:'noteDeletions'},make:()=>({queries:{deletionOwnership:storeQuery({role:'required'}),deletionCorrelations:storeQuery({role:'required'})},mutations:{}})});
    `
    })
  ).toStrictEqual([]);
});

testStable('material deletion queries allow descriptive status and preview names', async () => {
  expect(
    await lint({
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
      'apps/server/src/features/materials/store/descriptive.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'materialDeletion',plural:'materialDeletions'},make:()=>({queries:{readStatus:storeQuery({role:'required'}),previewDeletion:storeQuery({role:'optional'})},mutations:{}})});
    `
    })
  ).toStrictEqual([]);
});

testStable('history queries allow multiple descriptive required reads', async () => {
  expect(
    await lint({
      'apps/server/src/features/materials/store/history.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'materialHistory',plural:'materialHistories'},make:()=>({queries:{materialHistory:storeQuery({role:'required'}),findMaterialHistory:storeQuery({role:'optional'})},mutations:{}})});

      defineStore({entity:{singular:'materialHistoryPublication',plural:'materialHistoryPublications'},make:()=>({queries:{materialHistoryPublication:storeQuery({role:'required'})},mutations:{}})});

    `,
      'apps/server/src/features/sources/store/history.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'sourceMaterialHistory',plural:'sourceMaterialHistories'},make:()=>({queries:{sourceMaterialHistory:storeQuery({role:'required'})},mutations:{}})});

    `,
      'apps/server/src/features/materials/store/descriptive-history.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({entity:{singular:'materialHistory',plural:'materialHistories'},make:()=>({queries:{readStatus:storeQuery({role:'required'}),findMaterialHistory:storeQuery({role:'required'})},mutations:{}})});

    `
    })
  ).toStrictEqual([]);
});

testStable('document readers and reply provenance can coexist in one private store', async () => {
  expect(
    await lint({
      'apps/server/src/features/materials/store/reader.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'materialVersionDocument',plural:'materialVersionPages'},make:()=>({queries:{materialVersionDocument:storeQuery({role:'required'})},mutations:{}})});
        defineStore({entity:{singular:'materialVersionImage',plural:'materialVersionImages'},make:()=>({queries:{materialVersionImage:storeQuery({role:'required'})},mutations:{}})});
        defineStore({entity:{singular:'importedMaterial',plural:'importedMaterials'},make:()=>({queries:{importedMaterial:storeQuery({role:'required'})},mutations:{}})});
      `,
      'apps/server/src/features/notes/store/reply.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'replyVersion',plural:'replyVersions'},make:()=>({queries:{replyVersion:storeQuery({role:'required'})},mutations:{}})});
        defineStore({entity:{singular:'replyRequest',plural:'replyRequests'},make:()=>({queries:{findReplyRequest:storeQuery({role:'optional'})},mutations:{}})});
      `,
      'apps/server/src/features/materials/store/combined.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'materialReader',plural:'materialReaders'},make:()=>({queries:{materialVersionDocument:storeQuery({role:'required'}),materialVersionImage:storeQuery({role:'required'}),importedMaterial:storeQuery({role:'required'})},mutations:{}})});
      `,
      'apps/server/src/features/notes/store/combined.ts': `
        import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
        defineStore({entity:{singular:'replyRequest',plural:'replyRequests'},make:()=>({queries:{findReplyRequest:storeQuery({role:'optional'}),replyVersion:storeQuery({role:'required'})},mutations:{}})});
      `
    })
  ).toStrictEqual([]);
});

testStable(
  'export aggregates allow descriptive names while collections still require limits',
  async () => {
    expect(
      await lint({
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
      })
    ).toStrictEqual(['apps/server/src/features/materials/store/unbounded-export.ts']);
  }
);

testStable('allows several semantic queries per role through aliases and spreads', async () => {
  expect(
    await lint({
      'apps/server/src/features/notes/store/index.ts': `
      import { Schema } from 'effect';
      import { defineStore as create, storeQuery as query, storeMutation } from '#server/platform/definitions/define-store';
      const required = { role: 'required', input: Schema.String, output: Schema.String, run: input => input };
      const optional = { ...required, role: 'optional' };
      const collection = { role: 'collection', input: Schema.Struct({ limit: Schema.Int }), output: Schema.Array(Schema.String), run: () => [] };
      const reads = { readMessages: query(required), findLatestDraft: query(optional), recentMessages: query(collection) };
      create({entity: {singular: 'note', plural: 'notes'}, make: () => ({
        queries: { ...reads, readContext: query(required), findReplySource: query(optional), matchingMessages: query(collection), version2: query(required) },
        mutations: { saveDraft: storeMutation({ input: Schema.String, output: Schema.Void, run: input => {} }) }
      })});
    `
    })
  ).toStrictEqual([]);
});

testStable('rejects operation identifiers outside lower camel case in either group', async () => {
  expect(
    await lint({
      'apps/server/src/features/notes/store/index.ts': `
      import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
      const reads = { 'read-messages': storeQuery({role: 'required'}), ReadContext: storeQuery({role: 'required'}), _draft: storeQuery({role: 'optional'}) };
      defineStore({entity: {singular:'note',plural:'notes'}, make: () => ({
        queries: { ...reads, '': storeQuery({role:'required'}), '2messages': storeQuery({role:'required'}), 12: storeQuery({role:'required'}) },
        mutations: { 'save-draft': storeMutation({}), SaveContext: storeMutation({}) }
      })});
    `
    })
  ).toStrictEqual(Array(8).fill('apps/server/src/features/notes/store/index.ts'));
});

testStable('requires canonical constructors for semantic queries and mutations', async () => {
  expect(
    await lint({
      'apps/server/src/features/notes/store/index.ts': `
      import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
      import { storeQuery as otherQuery } from './other';
      const reads = { readMessages: {role:'required'}, readContext: otherQuery({role:'required'}) };
      defineStore({entity:{singular:'note',plural:'notes'}, make: () => ({
        queries: { ...reads, findDraft: storeMutation({role:'optional'}) },
        mutations: { saveDraft: storeQuery({role:'required'}) }
      })});
    `
    })
  ).toStrictEqual(Array(4).fill('apps/server/src/features/notes/store/index.ts'));
});

testStable('rejects missing, unknown and malformed literal query roles', async () => {
  expect(
    await lint({
      'apps/server/src/features/notes/store/index.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      const missing = {};
      const unknown = { role: 'snapshot' };
      defineStore({entity:{singular:'note',plural:'notes'}, make: () => ({queries:{
        readMessages: storeQuery(missing), readContext: storeQuery(unknown),
        findDraft: storeQuery({role:''}), findReply: storeQuery({role:null}),
        recentMessages: storeQuery({role:12})
      },mutations:{}})});
    `
    })
  ).toStrictEqual(Array(5).fill('apps/server/src/features/notes/store/index.ts'));
});

testStable(
  'descriptive operation names preserve descriptor and persistence boundary checks',
  async () => {
    const store = (operation: string) => `
    import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
    import { notes } from '@study/db';
    defineStore({entity:{singular:'project',plural:'projects'}, make: ({db}) => ({queries:{
      readMessageContext: storeQuery({role:'required',run(input) { ${operation} }})
    },mutations:{}})});
  `;
    const path = 'apps/server/src/features/projects/store/index.ts';
    const cases: [string, string][] = [
      ['synchronous-transactions', store('db.transaction(async () => 1);')],
      ['transaction-no-io', store('db.transaction(() => fetch(url));')],
      ['guarded-mutations', store('db.orm.delete(notes).run();')],
      [
        'feature-persistence-boundary',
        store('db.orm.update(notes).set({}).where(predicate).run();')
      ],
      [
        'feature-layout',
        `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({make: () => ({queries:{readMessageContext:storeQuery({run(db,input){}})},mutations:{}})});
    `
      ]
    ];

    for (const [rule, source] of cases)
      expect(await lintRulePaths(rule, { [path]: source })).toStrictEqual([path]);
  }
);

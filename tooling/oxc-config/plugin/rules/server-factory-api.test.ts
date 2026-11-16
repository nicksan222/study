import { test } from '@study/testing';

import { lintFiles } from '../test/utils.ts';

const store = "import * as api from '#server/platform/definitions/define-store';";

test.unit.stable(
  'RPC exports require canonical imported factories including aliases and nested paths',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/rpc/index.ts':
          "import {defineRpc as create} from '#server/platform/definitions/define-rpc'; const alias = create; export const layer = alias(group, handlers);",
        'src/features/b/rpc/nested.rpc.ts':
          "import * as api from '#server/platform/definitions/define-rpc'; const {defineRpc: create} = api; export default create(group, handlers);",
        'src/features/c/rpc/index.ts':
          'const defineRpc = () => ({}); export const layer = defineRpc(group, handlers);',
        'src/features/d/rpc/index.ts': "export { layer } from './unsafe';",
        'src/features/e/rpc/index.ts':
          "import {defineRpc} from '#server/platform/definitions/define-rpc'; function fake(defineRpc) { return defineRpc(group, handlers); } export const layer = fake(local);"
      },
      'module-factories'
    );

    assert.strictEqual(results.length, 3, JSON.stringify(results));
  }
);

test.unit.stable(
  'workflow exports require canonical definitions and registrations',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/workflows/index.ts': `
        import { defineWorkflow } from '#server/platform/definitions/define-workflow';
        import * as api from '#server/platform/definitions/define-workflow-handler';
        const alias = api;
        export const workflow = defineWorkflow({});
        export const execute = () => effect;
        export const registration = alias.defineWorkflowHandler(workflow, { execute, triggers: [] });
        `,
        'src/features/b/workflows/nested.ts':
          'export const custom = { definition: workflow, layer, triggers: [] };',
        'src/features/c/workflows/index.ts':
          'const defineWorkflowHandler = () => ({}); export const registration = defineWorkflowHandler(workflow, {});',
        'src/features/d/workflows/index.ts': "export { oldTrigger } from './other';"
      },
      'module-factories'
    );

    assert.strictEqual(results.length, 3, JSON.stringify(results));
  }
);

test.unit.stable(
  'store operations require the correct canonical branded descriptor constructor',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const files: Record<string, string> = {};

    for (const [name, query, mutation] of [
      ['good', 'q({role:"required"})', 'm({})'],
      ['plain', '{role:"required"}', 'm({})'],
      ['swapped', 'm({role:"required"})', 'q({})'],
      ['fake', 'fake({role:"required"})', 'm({})']
    ])
      files[`src/features/${name}/store/index.ts`] =
        `${store} const {storeQuery:q,storeMutation:m} = api; const fake = x => x; api.defineStore({entity:{singular:'item',plural:'items'},make:()=>({queries:{item:${query}},mutations:{save:${mutation}}})});`;

    assert.strictEqual((await lintFiles({ assert }, files, 'operation-conventions')).length, 4);
  }
);

test.unit.stable(
  'services reject raw Database and obsolete imported store bindings without property bans',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/service/nested.ts':
          "import {Database as DB} from '#server/platform/database/database'; export const effect = DB;",
        'src/features/b/service/index.ts':
          "import * as stores from '#server/features/b/store'; const alias = stores; alias.BStore.make();",
        'src/features/c/service/index.ts':
          "import {CStore as Store} from '#server/features/c/store'; const alias = Store; const {layer} = alias;",
        'src/features/d/service/index.ts':
          "import {DStore} from '#server/features/d/store'; function local(DStore) { return DStore.make(); } const arbitrary = {key:1,make(){},layer:2}; arbitrary.make();",
        'src/features/e/workflows/index.ts':
          "import {Database} from '#server/platform/database/database'; const value = Database;",
        'src/features/f/service/index.ts': `${store} import {FStore} from '#server/features/f/store'; api.useStore(FStore); api.transaction(tx => tx.store(FStore));`
      },
      'server-layer-boundary'
    );

    assert.strictEqual(results.length, 3, JSON.stringify(results));
  }
);

test.unit.stable(
  'transaction aliases reject asynchronous callbacks',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/service/index.ts': `${store} const {transaction: run} = api; run(async tx => tx.store(Store));`,
        'src/features/b/service/index.ts': `${store} const ns = api; const run = ns.publicationTransaction; run(tx => fetch('url'));`,
        'src/features/c/service/index.ts':
          'function transaction(fn) { return fn(); } transaction(async () => fetch("url"));'
      },
      'synchronous-transactions'
    );

    assert.strictEqual(results.length, 1);
  }
);

test.unit.stable(
  'publication transaction aliases cannot perform I/O',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/service/index.ts': `${store} const {transaction: run} = api; run(async tx => tx.store(Store));`,
        'src/features/b/service/index.ts': `${store} const ns = api; const run = ns.publicationTransaction; run(tx => fetch('url'));`,
        'src/features/c/service/index.ts':
          'function transaction(fn) { return fn(); } transaction(async () => fetch("url"));'
      },
      'transaction-no-io'
    );

    assert.strictEqual(results.length, 1);
  }
);

test.unit.stable(
  'native feature conversion stays behind canonical factories',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/rpc/index.ts':
          "import {AuthRpc as group} from '@study/contracts'; const alias = group; const {toLayer: run} = alias; run(handlers);",
        'src/features/b/workflows/index.ts':
          "import {defineWorkflow as create} from '#server/platform/definitions/define-workflow'; const workflow = create({}); const alias = workflow; alias.toLayer(execute);",
        'src/features/c/workflows/index.ts':
          "import * as jobs from '#server/features/c/workflows/job'; jobs.jobWorkflow.toLayer(execute);",
        'src/features/d/rpc/index.ts': 'const group = {toLayer(){}}; group.toLayer(handlers);'
      },
      'workflow-boundary'
    );

    assert.strictEqual(results.length, 3, JSON.stringify(results));
  }
);

test.unit.stable(
  'backend useStore is not a React hook and frontend hook rules stay enforced',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = (
      await lintFiles(
        { assert },
        {
          'apps/server/src/platform/example.ts':
            "import {useStore} from '#server/platform/definitions/define-store'; function makeService() { return useStore(Store); }",
          'apps/client/src/example.tsx':
            "import {useState} from 'react'; export function invalid() { return useState(0); }"
        },
        undefined,
        true
      )
    ).filter(({ code }) => code.includes('rules-of-hooks'));

    assert.strictEqual(results.length, 1, JSON.stringify(results));
    assert.ok(results[0]?.filename.includes('/apps/client/'));
  }
);

test.unit.stable(
  'canonical bindings resist fake modules, type imports, cyclic aliases and nested namespace destructuring',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/relative/rpc/index.ts':
          "import { defineRpc as create } from '../../../platform/definitions/define-rpc.ts'; export default (create)(group, handlers);",
        'src/features/namespace/rpc/index.ts': `
        import * as api from '#server/platform/definitions/define-rpc';
        const ns = api;
        const { defineRpc: create } = ns;
        const alias = create;
        export { aliasResult as layer };
        const aliasResult = alias(group, handlers);
          `,
        'src/features/type/rpc/index.ts':
          "import type {defineRpc} from '#server/platform/definitions/define-rpc'; export default defineRpc(group, handlers);",
        'src/features/fake/rpc/index.ts':
          "import {defineRpc} from './define-rpc'; export default defineRpc(group, handlers);",
        'src/features/cycle/rpc/index.ts':
          'const a = b; const b = a; export default a(group, handlers);',
        'src/features/shadow/rpc/index.ts':
          "import * as api from '#server/platform/definitions/define-rpc'; export default ((api) => api.defineRpc(group, handlers))({defineRpc: fake});",
        'src/features/reexport/rpc/index.ts': "export * from './safe';"
      },
      'module-factories'
    );

    assert.strictEqual(results.length, 5, JSON.stringify(results));
  }
);

test.unit.stable(
  'Database namespace reads and default store imports retain precise boundaries',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/service/nested.ts':
          "import * as api from '#server/platform/database/database'; const ns = api; const {Database: DB} = ns; const effect = DB;",
        'src/features/b/service/nested.ts':
          "import * as api from '#server/platform/database/database'; const ns = api; const effect = ns.Database;",
        'src/features/c/service/nested.ts':
          "import * as api from '#server/platform/database/database'; const effect = api.databaseChanges;",
        'src/features/d/service/nested.ts':
          "import Store from '#server/features/d/store'; Store['make']();",
        'src/features/e/service/nested.ts':
          "import type {Database} from '#server/platform/database/database'; export type Needs = Database;"
      },
      'server-layer-boundary'
    );

    assert.strictEqual(results.length, 3, JSON.stringify(results));
  }
);

test.unit.stable(
  'local native conversion aliases cannot bypass factories while shadowed imports stay unrelated',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/workflows/nested.ts':
          "import {defineWorkflow} from '#server/platform/definitions/define-workflow'; const workflow = defineWorkflow({}); const {toLayer: run} = workflow; run(execute);",
        'src/features/b/rpc/index.ts':
          "import * as RpcGroup from 'effect/rpc/RpcGroup'; const group = RpcGroup.make(request); const alias = group; alias.toLayer(handlers);",
        'src/features/c/workflows/index.ts':
          "import {jobWorkflow} from '#server/features/c/workflows/job'; function local(jobWorkflow) { jobWorkflow.toLayer(execute); }",
        'src/features/d/rpc/index.ts':
          "import {AuthRpc} from '@study/contracts'; function local(AuthRpc) { AuthRpc.toLayer(handlers); }"
      },
      'workflow-boundary'
    );

    assert.strictEqual(results.length, 2, JSON.stringify(results));
  }
);

test.unit.stable(
  'unregistered workflow factories cannot publish an alternate registration API',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/workflows/index.ts':
          'export const alternateRegistration = () => ({definition: workflow, layer, triggers: []});',
        'src/features/b/workflows/index.ts': `
        import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
        function execute() {
          return effect;
        }
        export { execute };
        export const registration = defineWorkflowHandler(workflow, { execute, triggers: [] });
          `
      },
      'module-factories'
    );

    assert.strictEqual(results.length, 1);
  }
);

test.unit.stable(
  'spreading query descriptors cannot bypass required literal roles',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/store/index.ts': `${store} const operations = { item: {role:'required'} }; const queries = {...operations}; api.defineStore({entity:{singular:'item',plural:'items'},make:()=>({queries,mutations:{}})});`
      },
      'operation-conventions'
    );

    assert.strictEqual(results.length, 1);
  }
);

test.unit.stable(
  'nested store destructuring enforces obsolete bindings without trusting shadows or type imports',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/service/nested.ts':
          "import * as stores from '#server/features/a/store'; const {AStore:{make,key,layer}}=stores; make(); key; layer;",
        'src/features/b/service/nested.ts':
          "import * as stores from '#server/features/b/store'; function local(stores) { const {BStore:{make,key,layer}}=stores; make(); }",
        'src/features/c/service/nested.ts':
          "import type * as stores from '#server/features/c/store'; const {CStore:{make,key,layer}}=stores;",
        'src/features/d/service/nested.ts':
          'const stores = {DStore:{make(){},key:1,layer:2}}; const {DStore:{make,key,layer}}=stores; make();'
      },
      'server-layer-boundary'
    );

    assert.strictEqual(results.length, 3, JSON.stringify(results));
    assert.ok(results.every(({ filename }) => filename.includes('/features/a/')));
  }
);

test.unit.stable(
  'const aliases preserve local destructured native conversion provenance and cycle protection',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const results = await lintFiles(
      { assert },
      {
        'src/features/a/workflows/nested.ts':
          "import {defineWorkflow} from '#server/platform/definitions/define-workflow'; const workflow = defineWorkflow({}); const {toLayer:run}=workflow; const alias=run; const again=alias; again(execute);",
        'src/features/b/rpc/index.ts':
          "import * as RpcGroup from 'effect/rpc/RpcGroup'; const group=RpcGroup.make(request); const {toLayer:run}=group; const alias=run; const again=alias; again(handlers);",
        'src/features/c/workflows/nested.ts':
          'const workflow={toLayer(){}}; const {toLayer:run}=workflow; const alias=run; alias(execute);',
        'src/features/d/workflows/nested.ts':
          'const first=second; const second=first; first(execute);',
        'src/features/e/workflows/nested.ts': `
        import { defineWorkflow } from '#server/platform/definitions/define-workflow';
        function local(defineWorkflow) {
          const workflow = defineWorkflow({});
          const { toLayer: run } = workflow;
          const alias = run;
          alias(execute);
        }
          `
      },
      'workflow-boundary'
    );

    assert.strictEqual(results.length, 2, JSON.stringify(results));
  }
);

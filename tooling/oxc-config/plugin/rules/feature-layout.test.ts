import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('requires canonical feature role folders and bound resource APIs', () => {
  const diagnostics = lintRule('feature-layout', {
    'src/features/a/old.store.ts': 'export const x = 1;',
    'src/features/a/service/nested/other.workflow.ts': 'export const x = 1;',
    'src/features/a/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; import type { Db } from '@study/db'; defineStore({ queries: {} }); storeQuery({run: (db, input) => input}); function query(db: Db) { return db; }`,
    'src/features/b/store/read.ts': `import type { StoreResources } from '#server/platform/definitions/define-store'; export function makeReads({db}: StoreResources) { return { read: (clock: string) => clock }; }`,
    'src/features/b/service/index.ts': 'export const x = 1;'
  });

  assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
});

testStable('keeps feature entry exports on the public service boundary', () => {
  const diagnostics = lintRule('server-layer-boundary', {
    'src/features/a/index.ts': `export type { Item } from './store/index.ts'; export { A } from './service/index.ts';`,
    'src/features/b/service/index.ts': `import { Store } from '../store/index.ts';`,
    'src/features/c/rpc/index.ts': `import { Store } from '../store/index.ts';`
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('rejects public aliases and nested entrypoint loopholes', () => {
  const diagnostics = lintRule('feature-layout', {
    'src/features/a/index.ts': `import type { Hidden } from './service/index.ts'; export type Alias = Hidden;`,
    'src/features/b/store/nested/index.ts': `export const Store = 1;`,
    'src/features/c/store/index.ts': `import { defineStore, storeMutation } from '#server/platform/definitions/define-store'; defineStore({make: () => ({queries: {}, mutations: {save: storeMutation({run(db, input) {}})}})});`
  });

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable('detects aliased resource types without confusing domain fields', () => {
  const diagnostics = lintRule('feature-layout', {
    'src/features/a/store/read.ts': `import type { Db as Database } from '@study/db'; import type { Clock as Time } from 'effect'; import type { StoreResources as Resources } from '#server/platform/definitions/define-store'; function read(db: Database) {} function now(clock: Time.Clock) {} function makeReads(resources: Resources) {} function domain(db: string, clock: number) {}`
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('requires make to return bound descriptor groups', () => {
  const diagnostics = lintRule('feature-layout', {
    'src/features/a/store/index.ts': `import { defineStore } from '#server/platform/definitions/define-store'; defineStore({make: () => ({})});`,
    'src/features/b/store/index.ts': `import { defineStore } from '#server/platform/definitions/define-store'; defineStore({make: () => ({queries: {}, mutations: {}})});`
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('bound aliases preserve each persistence boundary', () => {
  const prefix = `import { defineStore, storeMutation } from '#server/platform/definitions/define-store'; import { sessions, workflow_executions } from '@study/db'; defineStore({make: resources => { const {db} = resources; const alias = db; return {queries: {}, mutations: {save: storeMutation({run(input) { `;
  const suffix = ` }})}}; }});`;
  const cases: [string, string][] = [
    ['executed-query', 'alias.orm.select().from(sessions);'],
    ['guarded-mutations', 'alias.orm.delete(sessions).run();'],
    ['synchronous-transactions', 'alias.transaction(async () => 1);'],
    ['feature-persistence-boundary', 'alias.orm.update(sessions).set({}).where(predicate).run();'],
    [
      'workflow-persistence-boundary',
      'alias.orm.update(workflow_executions).set({}).where(predicate).run();'
    ]
  ];

  for (const [rule, operation] of cases) {
    const diagnostics = lintRule(rule, {
      'src/features/projects/store/index.ts': prefix + operation + suffix
    });

    assert.strictEqual(diagnostics.length, 1, `${rule}: ${JSON.stringify(diagnostics)}`);
    assert.strictEqual(diagnostics[0]?.code, `study(${rule})`);
  }
});

testStable(
  'resolves resource aliases and namespace types while restricting construction to stores',
  () => {
    const diagnostics = lintRule('feature-layout', {
      'src/features/a/store/read.ts': `import type * as Storage from '@study/db'; import type * as E from 'effect'; import type { StoreResources as R } from '../../../platform/definitions/define-store'; type Connection = Storage.Db; type Alias = Connection; type Resources = R; type Loop = Loop; function read(db: Alias) {} function now(clock: E.Clock.Clock) {} function makeReads({db}: Resources) {} function domain(db: string, clock: number, value: Loop) {}`,
      'src/features/a/rpc/index.ts': `import type { StoreResources } from '../../../platform/definitions/define-store'; function makeRpc(resources: StoreResources) {}`,
      'src/features/a/agents/index.ts': `import type * as Context from '../../../runtime/context'; function agent(context: Context.ServerContext) {}`
    });

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

testStable('respects shadowed namespace type bindings and cyclic aliases', () => {
  const diagnostics = lintRule('feature-layout', {
    'src/features/a/store/read.ts': `import type * as Storage from '@study/db'; type A = B; type B = A; function read<Storage>(db: Storage, other: A) {} function real(db: Storage.Db) {}`
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('current ServerContext aliases retain resource and persistence ownership', () => {
  for (const declaration of [
    "import type { ServerContext as Context } from '#server/platform/database/context'; type Alias = Context;",
    "import type * as Database from '../../../platform/database/context'; type Alias = Database.ServerContext;"
  ]) {
    for (const [rule, body] of [
      ['feature-layout', ''],
      ['synchronous-transactions', 'ctx.transaction(async () => 1);'],
      [
        'feature-persistence-boundary',
        'ctx.db.orm.update(sessions).set({}).where(predicate).run();'
      ]
    ]) {
      const diagnostics = lintRule(rule, {
        'src/features/projects/store/read.ts': `${declaration} import { sessions } from '@study/db'; function read(ctx: Alias) { ${body} }`
      });

      assert.strictEqual(diagnostics.length, 1, `${rule}: ${JSON.stringify(diagnostics)}`);
    }
  }
});

testStable(
  'allows an optional typed bound canonical reader after the one resource parameter',
  () => {
    const diagnostics = lintRule('feature-layout', {
      'src/features/materials/store/citations.ts': `
      import type { StoreResources } from '#server/platform/definitions/define-store';
      import { makeReads } from './reads';
      function makeCitations(resources: StoreResources, readDocument?: ReturnType<typeof makeReads>['readCanonicalDocument']) {}
    `
    });

    expect(diagnostics).toStrictEqual([]);
  }
);

testStable(
  'rejects required dependencies, untyped optional arguments and extra resource parameters',
  () => {
    const diagnostics = lintRule('feature-layout', {
      'src/features/materials/store/citations.ts': `
      import type { StoreResources } from '#server/platform/definitions/define-store';
      import type { Db } from '@study/db';
      import { makeReads } from './reads';
      function makeRequired(resources: StoreResources, reader: ReturnType<typeof makeReads>['readCanonicalDocument']) {}
      function makeUntyped(resources: StoreResources, reader?) {}
      function makeResources(resources: StoreResources, second?: StoreResources) {}
      function makeDatabase(resources: StoreResources, database?: Db) {}
      function makeOpaque(resources: StoreResources, reader?: string) {}
    `
    });

    assert.strictEqual(diagnostics.length, 7, JSON.stringify(diagnostics));
  }
);

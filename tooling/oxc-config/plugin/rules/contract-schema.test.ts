import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('reports the prohibited pattern', () => {
  const diagnostics = lintRule(
    'contract-schema',
    { 'packages/contracts/src/user.ts': 'export interface User { id: string }' },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'recognizes Effect schema aliases and leaves unrelated values and derived types alone',
  () => {
    const diagnostics = lintRule(
      'contract-schema',
      {
        'packages/contracts/src/user.ts':
          "import { Schema as S } from 'effect'; const alias = S; export const User = alias.Struct({ value: S.Unknown }); export type User = typeof User.Type; function f(S: any) { return S.Unknown; }",
        'packages/contracts/src/good.ts':
          'const Schema = { Unknown: 1 }; export const value = Schema.Unknown; export type Result = string | number;'
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

testStable('rejects exported aliases to handwritten objects and inferred database types', () => {
  const diagnostics = lintRule(
    'contract-schema',
    {
      'packages/contracts/src/a.ts':
        'interface Hidden { x: string }; type Shape = Hidden; export type Public = Shape; type Row = typeof table.$inferSelect; export type Result = Row;'
    },
    true
  );

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('rejects handwritten brands tied to imported Effect Brand', () => {
  const diagnostics = lintRule(
    'contract-schema',
    {
      'packages/contracts/src/a.ts':
        "import type { Brand as B } from 'effect'; export type A = string & B.Brand<'A'>; export type C = B.Branded<string, 'C'>;"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable(
  'export lists, nested handwritten shapes and structural brands cannot bypass canonical schemas',
  () => {
    const diagnostics = lintRule(
      'contract-schema',
      {
        'packages/contracts/src/a.ts':
          'interface Hidden { id: string }; export { type Hidden as Public }; export type ProjectId = bigint & {readonly __brand: "Project"}; export type Data = Readonly<{value: string}>;',
        'packages/contracts/src/b.ts':
          'export type Plain = string | number; export type Derived = Readonly<typeof schema.Type>;'
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable('native RPC declarations specify payload, success and error schemas', () => {
  const diagnostics = lintRule(
    'contract-schema',
    {
      'packages/contracts/src/sources/rpc.ts':
        "import { Rpc, RpcGroup } from 'effect/rpc'; const make = Rpc.make; export const Group = RpcGroup.make(make('a', { payload: {}, success: Schema.String, error: failure }), make('b', { success: Schema.String })); function f(Rpc: any) { Rpc.make('c', {}); }"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'rich content remains schema-derived rather than a parallel public editor payload',
  () => {
    const diagnostics = lintRule(
      'contract-schema',
      {
        'packages/contracts/src/documents.ts': `
      import { Schema } from 'effect';
      interface Node { kind: string; children: readonly Node[] }
      export type Editor = Readonly<{ blocks: readonly Node[] }>;
      export const unchecked = Schema.Struct({ content: Schema.Unknown });
      export type Canonical = typeof documentSchema.Type;
      export type Block = Canonical['blocks'][number];
    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable(
  'run metadata derives from schemas instead of unchecked preference or parallel context objects',
  () => {
    const diagnostics = lintRule(
      'contract-schema',
      {
        'packages/contracts/src/conversations/capture.ts': `
      import { Schema } from 'effect';
      import { runPreferencesSchema, runSelectionContextSchema } from './context';
      export type Context = typeof runSelectionContextSchema.Type;
      export const input = Schema.Struct({ preferences: runPreferencesSchema });
      export interface ParallelContext { requestId: string; preferences: Record<string, string> }
      export const unchecked = Schema.Struct({ preferences: Schema.Unknown });
    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable(
  'Material deletion scope and status derive from canonical schemas rather than parallel unchecked payloads',
  () => {
    const diagnostics = lintRule(
      'contract-schema',
      {
        'packages/contracts/src/materials/deletion.ts': `
      import { Schema } from 'effect';
      import { materialIdSchema, materialVersionIdSchema } from '../ids';
      export const scope = Schema.Struct({ materialId: materialIdSchema, descendantIds: Schema.Array(materialIdSchema), versionIds: Schema.Array(materialVersionIdSchema) });
      export type Scope = typeof scope.Type;
      export interface ParallelScope { materialId: number; descendantIds: number[] }
      export const unchecked = Schema.Struct({ selection: Schema.Unknown });
    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable(
  'history policies, exact candidates and native operations derive from checked schemas',
  () => {
    const diagnostics = lintRule(
      'contract-schema',
      {
        'packages/contracts/src/materials/history.ts': `
      import { Schema } from 'effect';
      import { materialIdSchema, materialVersionIdSchema } from '../ids';
      export const scope = Schema.Struct({ materialId: materialIdSchema, candidates: Schema.Array(materialVersionIdSchema) });

      export type Scope = typeof scope.Type;

      export interface UncheckedScope { materialId: number; candidates: number[] }
      export const unchecked = Schema.Struct({ policy: Schema.Unknown });

    `,
        'packages/contracts/src/materials/rpc.ts': `
      import { Rpc } from 'effect/rpc';
      Rpc.make('previewHistoryPrune', { payload: scope, success: preview, error: failure });

      Rpc.make('requestHistoryPrune', { payload: scope, success: status });

    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable('backup descriptors and restore acknowledgements use checked canonical schemas', () => {
  const diagnostics = lintRule(
    'contract-schema',
    {
      'packages/contracts/src/system/backups.ts': `
      import { Schema } from 'effect';

      export const status = Schema.Struct({state: Schema.Literals(['idle', 'restart-required', 'applied']), recoveryCopy: Schema.Boolean});

      export type Status = typeof status.Type;

      export interface UncheckedRestore { backupId: string; target: string }

      export const unchecked = Schema.Struct({manifest: Schema.Unknown});

    `
    },
    true
  );

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

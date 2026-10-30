import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('reports the prohibited pattern', () => {
  const diagnostics = lintRule(
    'contract-schema',
    { 'packages/contracts/src/user.ts': 'export interface User { id: string }' },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('recognizes Effect schema aliases and leaves unrelated values and derived types alone', () => {
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

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('rejects exported aliases to handwritten objects and inferred database types', () => {
  const diagnostics = lintRule(
    'contract-schema',
    {
      'packages/contracts/src/a.ts':
        'interface Hidden { x: string }; type Shape = Hidden; export type Public = Shape; type Row = typeof table.$inferSelect; export type Result = Row;'
    },
    true
  );

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('rejects handwritten brands tied to imported Effect Brand', () => {
  const diagnostics = lintRule(
    'contract-schema',
    {
      'packages/contracts/src/a.ts':
        "import type { Brand as B } from 'effect'; export type A = string & B.Brand<'A'>; export type C = B.Branded<string, 'C'>;"
    },
    true
  );

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('export lists, nested handwritten shapes and structural brands cannot bypass canonical schemas', () => {
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

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('native RPC declarations specify payload, success and error schemas', () => {
  const diagnostics = lintRule(
    'contract-schema',
    {
      'packages/contracts/src/sources/rpc.ts':
        "import { Rpc, RpcGroup } from 'effect/rpc'; const make = Rpc.make; export const Group = RpcGroup.make(make('a', { payload: {}, success: Schema.String, error: failure }), make('b', { success: Schema.String })); function f(Rpc: any) { Rpc.make('c', {}); }"
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

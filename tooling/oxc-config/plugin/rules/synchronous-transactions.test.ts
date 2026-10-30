import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('synchronous-transactions guards production and accepts safe alternatives', () => {
  const diagnostics = lintRule('synchronous-transactions', {
    'src/bad.ts':
      "import { Db } from '@study/db'; const db = Db.open(':memory:'); db.transaction(async () => 1); db.transaction(() => Promise.resolve(1));",
    'src/good.ts':
      'const other = { transaction: async fn => fn() }; other.transaction(async () => 1);',
    'src/fixture.test.ts':
      "import { Db } from '@study/db'; const db = Db.open(':memory:'); db.transaction(async () => 1); db.transaction(() => Promise.resolve(1));"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('synchronous-transactions handles aliases and avoids unrelated bindings', () => {
  const diagnostics = lintRule('synchronous-transactions', {
    'src/bad.ts':
      "import { Db as Database } from '@study/db'; import { Effect as E } from 'effect'; function f(db: Database) { db.transaction(() => { return E.succeed(1); }); }",
    'src/good.ts':
      "import { Db } from '@study/db'; function f(Db) { const db = Db.open(path); db.transaction(async () => 1); }"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('transactions recognize Effect namespace, const aliases and named async callbacks', () => {
  const diagnostics = lintRule('synchronous-transactions', {
    'src/bad.ts':
      "import * as E from 'effect/Effect'; import { Db } from '@study/db'; const Effect = E; const db = Db.open(':memory:'); const work = async () => 1; const value = E.succeed(1); db.transaction(work); db.transaction(() => Effect.succeed(1)); db.transaction(() => value);",
    'src/good.ts':
      "import * as E from 'effect/Effect'; import { Db } from '@study/db'; const db = Db.open(':memory:'); db.transaction(() => E.isEffect(1)); function f(E) { db.transaction(() => E.succeed(1)); }"
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('named block callbacks and constant database aliases stay synchronous', () => {
  const diagnostics = lintRule('synchronous-transactions', {
    'src/bad.ts':
      "import type { ServerContext } from '#server/runtime/context'; function operation(ctx: ServerContext) { const db = ctx.db; const work = () => { return Promise.resolve(1); }; db.transaction(work); function next() { return Promise.resolve(2); } db.transaction(next); }",
    'src/good.ts':
      'const db = { transaction: f => f() }; const work = () => Promise.resolve(1); db.transaction(work);'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('factory-owned database callbacks cannot start asynchronous transactions', () => {
  const diagnostics = lintRule('synchronous-transactions', {
    'src/features/items/store/index.ts': `import { defineStore, storeMutation as command } from '#server/platform/definitions/define-store'; defineStore({ make: ({db}) => ({queries: {}, mutations: {save: command({ run(input) { db.transaction(async () => 1); } })}}) });`
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

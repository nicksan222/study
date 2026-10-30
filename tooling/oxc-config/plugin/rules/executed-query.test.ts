import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('reports executed-query', () => {
  const diagnostics = lintRule('executed-query', {
    'src/bad.ts':
      "import type { Db } from '@study/db'; function f(db: Db) { db.orm.select().from(items); }"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('only reports obvious discarded builders on typed owners', () => {
  const diagnostics = lintRule('executed-query', {
    'src/bad.ts':
      "import type { ServerContext as C } from '#server/runtime/context'; function f(ctx: C) { const db = ctx.db; db.orm.select().from(items); const query = db.orm.delete(items); query.where(pred); }",
    'src/good.ts':
      "import type { Db } from '@study/db'; function f(db: Db, other) { const q = db.orm.select(); db.orm.select().all(); other.orm.select(); db.orm.run(sql); return db.orm.select(); }"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('factory query callbacks must execute discarded builders', () => {
  const diagnostics = lintRule('executed-query', {
    'src/features/items/store/index.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({ make: ({db}) => ({queries: { items: storeQuery({ run(input) { db.orm.select().from(items); db.orm.select().from(items).all(); } }) }, mutations: {}}) });
    `
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

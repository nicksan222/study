import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('no-non-null-query-results guards production and accepts safe alternatives', () => {
  const diagnostics = lintRule('no-non-null-query-results', {
    'src/bad.ts': 'store.db.orm.select().from(table).get()!; rows.find(x => x.id === id)!;',
    'src/good.ts':
      'const row = store.db.orm.select().from(table).get(); if (!row) throw new Error("missing");',
    'src/fixture.test.ts': 'store.db.orm.select().from(table).get()!; rows.find(x => x.id === id)!;'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('no-non-null-query-results handles aliases and avoids unrelated bindings', () => {
  const diagnostics = lintRule('no-non-null-query-results', {
    'src/bad.ts': 'db.orm.get(query)!; values.findFirst()!;',
    'src/good.ts':
      'const cache = new Map(); cache.get(key)!; const custom = { get() { return 1; } }; custom.get()!;'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('missing rows cannot be asserted into required query results', () => {
  const diagnostics = lintRule('no-non-null-query-results', {
    'src/bad.ts': 'const a = null!; const b = undefined!; const c = (void 0)!;',
    'src/good.ts': 'const missing = null; function local(undefined: number) { return undefined!; }'
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

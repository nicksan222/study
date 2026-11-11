import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable(
  'no-non-null-query-results guards production and accepts safe alternatives',
  async () => {
    const diagnostics = await lintRule('no-non-null-query-results', {
      'src/bad.ts': 'store.db.orm.select().from(table).get()!; rows.find(x => x.id === id)!;',
      'src/good.ts':
        'const row = store.db.orm.select().from(table).get(); if (!row) throw new Error("missing");',
      'src/fixture.test.ts':
        'store.db.orm.select().from(table).get()!; rows.find(x => x.id === id)!;'
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

testStable('no-non-null-query-results handles aliases and avoids unrelated bindings', async () => {
  const diagnostics = await lintRule('no-non-null-query-results', {
    'src/bad.ts': 'db.orm.get(query)!; values.findFirst()!;',
    'src/good.ts':
      'const cache = new Map(); cache.get(key)!; const custom = { get() { return 1; } }; custom.get()!;'
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('missing rows cannot be asserted into required query results', async () => {
  const diagnostics = await lintRule('no-non-null-query-results', {
    'src/bad.ts': 'const a = null!; const b = undefined!; const c = (void 0)!;',
    'src/good.ts': 'const missing = null; function local(undefined: number) { return undefined!; }'
  });

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

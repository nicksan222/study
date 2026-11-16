import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'rejects non-null assertions on missing query results',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'no-non-null-query-results', {
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

test.unit.stable(
  'no-non-null-query-results handles aliases and avoids unrelated bindings',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'no-non-null-query-results', {
      'src/bad.ts': 'db.orm.get(query)!; values.findFirst()!;',
      'src/good.ts':
        'const cache = new Map(); cache.get(key)!; const custom = { get() { return 1; } }; custom.get()!;'
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'missing rows cannot be asserted into required query results',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'no-non-null-query-results', {
      'src/bad.ts': 'const a = null!; const b = undefined!; const c = (void 0)!;',
      'src/good.ts':
        'const missing = null; function local(undefined: number) { return undefined!; }'
    });

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

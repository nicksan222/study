import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'requires database query builders to be executed',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'executed-query', {
      'src/bad.ts':
        "import type { Db } from '@study/db'; function f(db: Db) { db.orm.select().from(items); }"
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'flags discarded query builders on typed database owners',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'executed-query', {
      'src/bad.ts': `import type { ServerContext as C } from '#server/runtime/context';
function f(ctx: C) { const db = ctx.db;
db.orm.select().from(items);
const query = db.orm.delete(items);
query.where(pred);
}`,
      'src/good.ts': `import type { Db } from '@study/db';
function f(db: Db, other) { const q = db.orm.select();
db.orm.select().all();
other.orm.select();
db.orm.run(sql);
return db.orm.select();
}`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'factory query callbacks must execute discarded builders',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'executed-query', {
      'src/features/items/store/index.ts': `
      import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
      defineStore({ make: ({db}) => ({queries: { items: storeQuery({ run(input) { db.orm.select().from(items); db.orm.select().from(items).all(); } }) }, mutations: {}}) });
    `
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

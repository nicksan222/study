import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'rejects asynchronous database transaction callbacks in production',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'synchronous-transactions', {
      'src/bad.ts': `import { Db } from '@study/db';
 const db = Db.open(':memory:');
 db.transaction(async () => 1);
 db.transaction(() => Promise.resolve(1));
`,
      'src/good.ts':
        'const other = { transaction: async fn => fn() }; other.transaction(async () => 1);',
      'src/fixture.test.ts': `import { Db } from '@study/db';
 const db = Db.open(':memory:');
 db.transaction(async () => 1);
 db.transaction(() => Promise.resolve(1));
`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'synchronous-transactions handles aliases and avoids unrelated bindings',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'synchronous-transactions', {
      'src/bad.ts': `import { Db as Database } from '@study/db';
 import { Effect as E } from 'effect';
 function f(db: Database) { db.transaction(() => { return E.succeed(1);
 });
 }`,
      'src/good.ts': `import { Db } from '@study/db';
 function f(Db) { const db = Db.open(path);
 db.transaction(async () => 1);
 }`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'transactions recognize Effect namespace, const aliases and named async callbacks',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'synchronous-transactions', {
      'src/bad.ts': `import * as E from 'effect/Effect';
import { Db } from '@study/db';
const Effect = E;
const db = Db.open(':memory:');
const work = async () => 1;
const value = E.succeed(1);
db.transaction(work);
db.transaction(() => Effect.succeed(1));
db.transaction(() => value);`,
      'src/good.ts': `import * as E from 'effect/Effect';
import { Db } from '@study/db';
const db = Db.open(':memory:');
db.transaction(() => E.isEffect(1));
function f(E) { db.transaction(() => E.succeed(1));
}`
    });

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'named block callbacks and constant database aliases stay synchronous',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'synchronous-transactions', {
      'src/bad.ts': `import type { ServerContext } from '#server/runtime/context';
function operation(ctx: ServerContext) { const db = ctx.db;
const work = () => { return Promise.resolve(1);
};
db.transaction(work);
function next() { return Promise.resolve(2);
} db.transaction(next);
}`,
      'src/good.ts':
        'const db = { transaction: f => f() }; const work = () => Promise.resolve(1); db.transaction(work);'
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'factory-owned database callbacks cannot start asynchronous transactions',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'synchronous-transactions', {
      'src/features/items/store/index.ts': `import { defineStore, storeMutation as command } from '#server/platform/definitions/define-store';
 defineStore({ make: ({db}) => ({queries: {}, mutations: {save: command({ run(input) { db.transaction(async () => 1);
 } })}}) });
`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

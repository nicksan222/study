import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'rejects network requests inside database transactions while allowing tests',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'transaction-no-io', {
      'src/bad.ts':
        "import { Db } from '@study/db'; const db = Db.open(':memory:'); db.transaction(() => fetch(url));",
      'src/good.ts':
        'const other = { transaction: fn => fn() }; other.transaction(() => fetch(url));',
      'src/fixture.test.ts':
        "import { Db } from '@study/db'; const db = Db.open(':memory:'); db.transaction(() => fetch(url));"
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'transaction-no-io handles aliases and avoids unrelated bindings',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'transaction-no-io', {
      'src/bad.ts': `import { Db } from '@study/db';
 import { readFileSync as read } from 'node:fs';
 function f(db: Db) { db.transaction(() => { read(path);
 });
 }`,
      'src/good.ts':
        "import { Db } from '@study/db'; function f(db: Db, fetch) { db.transaction(() => fetch(url)); }"
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'named transaction callbacks cannot hide external I/O behind database aliases',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'transaction-no-io', {
      'src/bad.ts': `import type { ServerContext } from '#server/runtime/context';
function operation(ctx: ServerContext) { const db = ctx.db;
const work = () => { fetch(url);
return 1;
};
const alias = work;
db.transaction(alias);
}`,
      'src/good.ts': `import type { ServerContext } from '#server/runtime/context';
function operation(ctx: ServerContext) { const work = () => { const later = () => fetch(url);
return 1;
};
ctx.transaction(work);
}`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

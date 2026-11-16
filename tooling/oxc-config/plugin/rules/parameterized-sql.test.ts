import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'rejects dynamic sql.raw input in production while allowing constants and tests',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'parameterized-sql', {
      'src/bad.ts': "import { sql as query } from 'drizzle-orm'; query.raw(input);",
      'src/good.ts':
        "import { sql } from 'drizzle-orm'; sql.raw('SELECT 1'); function f(sql) { sql.raw(input); }",
      'src/fixture.test.ts': "import { sql as query } from 'drizzle-orm'; query.raw(input);"
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'parameterized-sql handles aliases and avoids unrelated bindings',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'parameterized-sql', {
      'src/bad.ts': `import { Db as Database } from '@study/db';
import { sql as query } from 'drizzle-orm';
const db = Database.open(':memory:');
db.exec('DELETE FROM items');
query.raw(\`SELECT \${input}\`);`,
      'src/good.ts':
        'const sql = { raw: value => value }; sql.raw(input); const db = { exec: value => value }; db.exec(input);'
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'constant database aliases do not permit connection-level SQL execution',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'parameterized-sql', {
      'src/bad.ts': `import type { ServerContext } from '#server/runtime/context';
 function operation(ctx: ServerContext) { const db = ctx.db;
 db.exec('DROP TABLE jobs');
 }`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'facade sql aliases and namespaces retain parameter binding checks',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'parameterized-sql', {
      'src/bad.ts': `import { sql as query } from '@study/db';
 import * as database from '@study/db';
 query.raw(input);
 database.sql.raw(input);
`,
      'src/good.ts': `import { sql as query } from '@study/db';
import * as database from '@study/db';
query.raw('SELECT 1');
database.sql.raw(\`SELECT 1\`);
function f(database, query) { database.sql.raw(input);
query.raw(input);
}`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

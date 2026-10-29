import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('parameterized-sql guards production and accepts safe alternatives', () => {
  const diagnostics = lintRule('parameterized-sql', {
    'src/bad.ts': "import { sql as query } from 'drizzle-orm'; query.raw(input);",
    'src/good.ts':
      "import { sql } from 'drizzle-orm'; sql.raw('SELECT 1'); function f(sql) { sql.raw(input); }",
    'src/fixture.test.ts': "import { sql as query } from 'drizzle-orm'; query.raw(input);"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('parameterized-sql handles aliases and avoids unrelated bindings', () => {
  const diagnostics = lintRule('parameterized-sql', {
    'src/bad.ts':
      "import { Db as Database } from '@study/db'; import { sql as query } from 'drizzle-orm'; const db = Database.open(':memory:'); db.exec('DELETE FROM items'); query.raw(`SELECT ${input}`);",
    'src/good.ts':
      'const sql = { raw: value => value }; sql.raw(input); const db = { exec: value => value }; db.exec(input);'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test('constant database aliases do not permit connection-level SQL execution', () => {
  const diagnostics = lintRule('parameterized-sql', {
    'src/bad.ts':
      "import type { ServerContext } from '#server/runtime/context'; function operation(ctx: ServerContext) { const db = ctx.db; db.exec('DROP TABLE jobs'); }"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('facade sql aliases and namespaces retain parameter binding checks', () => {
  const diagnostics = lintRule('parameterized-sql', {
    'src/bad.ts':
      "import { sql as query } from '@study/db'; import * as database from '@study/db'; query.raw(input); database.sql.raw(input);",
    'src/good.ts':
      "import { sql as query } from '@study/db'; import * as database from '@study/db'; query.raw('SELECT 1'); database.sql.raw(`SELECT 1`); function f(database, query) { database.sql.raw(input); query.raw(input); }"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('database connection and schema factories stay with their owners', () => {
  const diagnostics = lintRule(
    'database-ownership',
    {
      'apps/server/src/core-migrate.ts': "import { migrateSync } from 'drizzle-orm/sqlite-core';\n",
      'packages/db/src/schema/namespace.ts': "import * as core from 'drizzle-orm/sqlite-core';\n",
      'packages/db/src/schema/dynamic.ts': "const core = import('drizzle-orm/sqlite-core');\n",
      'packages/db/src/schema/migrate.ts':
        "import { migrateSync } from 'drizzle-orm/sqlite-core';\n",
      'packages/db/src/schema/leak.ts':
        "import { sqliteTable as table } from 'drizzle-orm/sqlite-core';\nexport { table };\n",
      'packages/db/src/db.ts':
        "import { DatabaseSync } from 'node:sqlite';\nexport { DatabaseSync };\nexport { migrateSync as expose } from 'drizzle-orm/sqlite-core';\nimport { migrateAsync as run } from 'drizzle-orm/sqlite-core';\nexport { run };\nimport { drizzle } from 'drizzle-orm/node-sqlite';\nimport { migrate } from 'drizzle-orm/node-sqlite/migrator';\n",
      'packages/db/src/schema/items.ts':
        "import { sqliteTable as table, sqliteView } from 'drizzle-orm/sqlite-core';\n",
      'packages/db/drizzle.config.ts': "import { defineConfig } from 'drizzle-kit';\n",
      'apps/server/src/good.ts':
        "import { eq, sql } from 'drizzle-orm';\nimport type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';\nimport type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';\nimport { Db } from '@study/db';\nconst sqliteTable = () => 1;\nconst object = { sqliteTable };\n",
      'apps/server/test/raw.test.ts': "import { DatabaseSync as Raw } from 'node:sqlite';\n",
      'apps/server/src/driver.ts': "export { drizzle as create } from 'drizzle-orm/node-sqlite';\n",
      'apps/server/src/migrator.ts': "export * from 'drizzle-orm/node-sqlite/migrator';\n",
      'apps/server/src/schema.ts':
        "import { sqliteTable as table } from 'drizzle-orm/sqlite-core';\n",
      'packages/db/src/not-schema.ts':
        "export { sqliteTableCreator } from 'drizzle-orm/sqlite-core';\n",
      'apps/server/src/namespace.ts':
        "import * as core from 'drizzle-orm/sqlite-core';\ncore.sqliteView('v');\n",
      'apps/server/src/dynamic.ts':
        "const core = import('drizzle-orm/sqlite-core');\nconst db = import('node:sqlite');\n",
      'apps/server/src/reexport.ts': "export * from 'drizzle-orm/sqlite-core';\n"
    },
    true
  );

  assert.deepEqual(
    diagnostics
      .map(({ filename, message }) => [filename.split(/\/(?:apps|packages)\//)[1], message])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [
      [
        'server/src/core-migrate.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ],
      [
        'server/src/driver.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ],
      [
        'server/src/dynamic.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ],
      ['server/src/dynamic.ts', 'SQLite schema factories belong in packages/db/src/schema/.'],
      [
        'server/src/migrator.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ],
      ['server/src/namespace.ts', 'SQLite schema factories belong in packages/db/src/schema/.'],
      ['server/src/reexport.ts', 'SQLite schema factories belong in packages/db/src/schema/.'],
      ['server/src/schema.ts', 'SQLite schema factories belong in packages/db/src/schema/.'],
      [
        'server/test/raw.test.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ],
      ['db/src/db.ts', 'SQLite connections and migrations belong in packages/db/src/db.ts.'],
      ['db/src/db.ts', 'SQLite connections and migrations belong in packages/db/src/db.ts.'],
      ['db/src/db.ts', 'SQLite connections and migrations belong in packages/db/src/db.ts.'],
      [
        'db/src/schema/namespace.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ],
      [
        'db/src/schema/dynamic.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ],
      [
        'db/src/schema/migrate.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ],
      ['db/src/schema/leak.ts', 'SQLite schema factories belong in packages/db/src/schema/.'],
      ['db/src/not-schema.ts', 'SQLite schema factories belong in packages/db/src/schema/.']
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
});

test('owner reexports cannot evade ownership by preceding imports', () => {
  const diagnostics = lintRule(
    'database-ownership',
    {
      'packages/db/src/db.ts':
        "export { raw, driver, migrate };\nimport { DatabaseSync as raw } from 'node:sqlite';\nimport { drizzle as driver } from 'drizzle-orm/node-sqlite';\nimport { migrateSync as migrate } from 'drizzle-orm/sqlite-core';\nexport type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';\nexport type { raw };\n",
      'packages/db/src/schema/example.ts':
        "export { table, makeView };\nimport { sqliteTable as table, sqliteView as makeView } from 'drizzle-orm/sqlite-core';\nexport type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';\nexport type { table };\n"
    },
    true
  );

  assert.deepEqual(
    diagnostics
      .map(({ filename, message }) => [filename.split(/\/(?:apps|packages)\//)[1], message])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [
      ...Array.from({ length: 3 }, () => [
        'db/src/db.ts',
        'SQLite connections and migrations belong in packages/db/src/db.ts.'
      ]),
      ...Array.from({ length: 2 }, () => [
        'db/src/schema/example.ts',
        'SQLite schema factories belong in packages/db/src/schema/.'
      ])
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
});

import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'database connection and schema factories stay with their owners',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'database-ownership',
      {
        'apps/server/src/core-migrate.ts':
          "import { migrateSync } from 'drizzle-orm/sqlite-core';\n",
        'packages/db/src/schema/namespace.ts': "import * as core from 'drizzle-orm/sqlite-core';\n",
        'packages/db/src/schema/dynamic.ts': "const core = import('drizzle-orm/sqlite-core');\n",
        'packages/db/src/schema/migrate.ts':
          "import { migrateSync } from 'drizzle-orm/sqlite-core';\n",
        'packages/db/src/schema/leak.ts':
          "import { sqliteTable as table } from 'drizzle-orm/sqlite-core';\nexport { table };\n",
        'packages/db/src/db.ts': `import { DatabaseSync } from 'node:sqlite';

export { DatabaseSync };

export { migrateSync as expose } from 'drizzle-orm/sqlite-core';

import { migrateAsync as run } from 'drizzle-orm/sqlite-core';

export { run };

import { drizzle } from 'drizzle-orm/node-sqlite';

import { migrate } from 'drizzle-orm/node-sqlite/migrator';

`,
        'packages/db/src/schema/items.ts':
          "import { sqliteTable as table, sqliteView } from 'drizzle-orm/sqlite-core';\n",
        'packages/db/drizzle.config.ts': "import { defineConfig } from 'drizzle-kit';\n",
        'apps/server/src/good.ts': `import { eq, sql } from 'drizzle-orm';

import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { Db } from '@study/db';

const sqliteTable = () => 1;

const object = { sqliteTable };

`,
        'apps/server/test/raw.test.ts': "import { DatabaseSync as Raw } from 'node:sqlite';\n",
        'apps/server/src/driver.ts':
          "export { drizzle as create } from 'drizzle-orm/node-sqlite';\n",
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

    expect(
      diagnostics
        .map(({ filename, message }) => [filename.split(/\/(?:apps|packages)\//)[1], message])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    ).toStrictEqual(
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
  }
);

test.unit.stable(
  'owner reexports cannot evade ownership by preceding imports',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'database-ownership',
      {
        'packages/db/src/db.ts': `export { raw, driver, migrate };

import { DatabaseSync as raw } from 'node:sqlite';

import { drizzle as driver } from 'drizzle-orm/node-sqlite';

import { migrateSync as migrate } from 'drizzle-orm/sqlite-core';

export type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

export type { raw };

`,
        'packages/db/src/schema/example.ts': `export { table, makeView };

import { sqliteTable as table, sqliteView as makeView } from 'drizzle-orm/sqlite-core';

export type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export type { table };

`
      },
      true
    );

    expect(
      diagnostics
        .map(({ filename, message }) => [filename.split(/\/(?:apps|packages)\//)[1], message])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    ).toStrictEqual(
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
  }
);

test.unit.stable(
  'snapshot machinery uses Db primitives without acquiring a second raw driver in runtime or storage',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'database-ownership', {
      'src/platform/database/backups.ts': "import { backup as snapshot } from 'node:sqlite';",
      'src/runtime/backups.ts': "import * as driver from 'node:sqlite';",
      'src/runtime/composition.ts': "import { Db } from '@study/db'; Db.openSnapshot(path);"
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'the metadata wrapper may construct tables without exposing raw factories',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'database-ownership',
      {
        'packages/db/src/table.ts':
          "import { sqliteTable, SQLiteTable } from 'drizzle-orm/sqlite-core';",
        'packages/db/src/schema-builder.ts':
          "export { integer, text } from 'drizzle-orm/sqlite-core';",
        'packages/db/src/unwrapped.ts': "import { sqliteTable } from 'drizzle-orm/sqlite-core';"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics[0]?.filename.endsWith('/unwrapped.ts'));
  }
);

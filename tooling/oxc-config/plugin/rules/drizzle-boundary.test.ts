import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('Drizzle imports and exports belong exclusively to the database package', () => {
  const diagnostics = lintRule(
    'drizzle-boundary',
    {
      'apps/server/src/direct.ts':
        "import { sql } from 'drizzle-orm'; import type { SQL } from 'drizzle-orm'; export * from 'drizzle-orm/sqlite-core'; export type { SQL } from 'drizzle-orm'; const migrate = import('drizzle-orm/node-sqlite/migrator'); type Query = import('drizzle-orm').SQL;",
      'apps/web/src/direct.ts': "export { defineConfig } from 'drizzle-kit';",
      'apps/server/test/direct.test.ts': "import { eq } from 'drizzle-orm';",
      'apps/server/src/facade.ts':
        "import { sql, eq } from '@study/db'; export type { SQL } from '@study/db';",
      'packages/db/src/db.ts': "import { drizzle } from 'drizzle-orm/node-sqlite';",
      'packages/db/src/schema/items.ts': "import { sqliteTable } from 'drizzle-orm/sqlite-core';",
      'packages/db/drizzle.config.ts': "import { defineConfig } from 'drizzle-kit';",
      'packages/db/test/query.test.ts': "import { sql } from 'drizzle-orm';",
      'tooling/example.test.ts': 'const fixture = "import { sql } from \'drizzle-orm\';";'
    },
    true
  );

  assert.equal(diagnostics.length, 8, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => !filename.includes('/packages/db/')));
});

test('Drizzle require calls respect lexical bindings and createRequire aliases', () => {
  const diagnostics = lintRule(
    'drizzle-boundary',
    {
      'apps/server/src/bad.ts':
        "import { createRequire as makeRequire } from 'node:module'; const load = makeRequire(import.meta.url); require('drizzle-orm'); load('drizzle-kit'); makeRequire(import.meta.url)('drizzle-orm/sql');",
      'apps/server/src/good.ts':
        "function f(require) { require('drizzle-orm'); } function g(makeRequire) { const load = makeRequire(url); load('drizzle-orm'); } const load = customLoader(); load('drizzle-kit');",
      'packages/db/src/require.ts':
        "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('drizzle-orm');"
    },
    true
  );

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/apps/server/src/bad.ts')));
});

test('Drizzle namespace createRequire and global loader forms stay behind the facade', () => {
  const diagnostics = lintRule(
    'drizzle-boundary',
    {
      'apps/desktop/src/bad.ts':
        "import * as modules from 'node:module'; const make = modules.createRequire; const load = make(import.meta.url); load(`drizzle-orm`); globalThis.require('drizzle-kit'); module.require('drizzle-orm');",
      'apps/desktop/src/good.ts':
        "import * as modules from 'node:module'; function f(modules, globalThis, module) { const load = modules.createRequire(url); load('drizzle-orm'); globalThis.require('drizzle-orm'); module.require('drizzle-orm'); }"
    },
    true
  );

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/apps/desktop/src/bad.ts')));
});

test('TypeScript CommonJS import declarations cannot bypass the database facade', () => {
  const diagnostics = lintRule(
    'drizzle-boundary',
    {
      'apps/server/src/direct.cts': "import orm = require('drizzle-orm'); export { orm };",
      'packages/db/src/driver.cts': "import orm = require('drizzle-orm'); export { orm };"
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics[0]?.filename.endsWith('/apps/server/src/direct.cts'));
});

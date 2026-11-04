import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('reports application-transactions', () => {
  const diagnostics = lintRule('application-transactions', {
    'src/bad.ts':
      "import type { Db } from '@study/db'; function f(db: Db) { db.orm.transaction(() => {}); }"
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('recognizes database aliases and preserves context and unrelated transactions', () => {
  const diagnostics = lintRule('application-transactions', {
    'src/bad.ts':
      "import type { Db as Database } from '@study/db'; import type { ServerContext as C } from '#server/runtime/context'; function f(db: Database, ctx: C) { const alias = db; alias.transaction(() => {}); const database = ctx.db; database.orm.transaction(() => {}); }",
    'src/good.ts':
      "import type { ServerContext } from '#server/runtime/context'; function f(ctx: ServerContext, db) { ctx.transaction(() => {}); db.transaction(() => {}); }",
    'src/platform/database/context.ts':
      "import type { Db } from '@study/db'; function f(db: Db) { db.orm.transaction(() => {}); }",
    'src/fixture.test.ts':
      "import type { Db } from '@study/db'; function f(db: Db) { db.transaction(() => {}); }"
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

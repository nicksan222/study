import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('reports sql-null-comparison', () => {
  const diagnostics = lintRule('sql-null-comparison', {
    'src/bad.ts': "import { eq } from '@study/db'; eq(items.id, null);"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('recognizes aliases and ignores quoted or commented SQL and shadowed names', () => {
  const diagnostics = lintRule('sql-null-comparison', {
    'src/bad.ts':
      "import { eq as equal, sql as query } from '@study/db'; import * as d from 'drizzle-orm'; const alias = equal; alias(col, null); d.ne(col, null); query`x <> NULL`; d.sql`NULL = x`;",
    'src/good.ts':
      "import { eq, sql } from '@study/db'; eq(col, value); sql`x IS NULL AND y = 'NULL' /* z != NULL */`; function f(eq, sql) { eq(col, null); sql`x = NULL`; }",
    'src/example.test.ts': "import { eq } from '@study/db'; eq(col, null);"
  });

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('NULL assignments are valid while comparisons in WHERE and assignment expressions fail', () => {
  const diagnostics = lintRule('sql-null-comparison', {
    'src/domains/projects/store.ts':
      "import { sql } from '@study/db'; sql`UPDATE projects SET error=NULL, title=NULL WHERE id=1`; sql`INSERT INTO projects VALUES(1) ON CONFLICT(id) DO UPDATE SET error=NULL`; sql`UPDATE projects SET title=CASE WHEN previous=NULL THEN 'a' END WHERE id=1`; sql`UPDATE projects SET error=NULL WHERE title=NULL`; sql`SELECT id FROM projects WHERE NULL = title`;"
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

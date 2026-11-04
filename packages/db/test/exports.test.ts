import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import * as database from '../src/index.ts';
import { projects } from '../src/schema.ts';

testStable(
  'database facade executes parameterized queries and schema predicates on its connection',
  () => {
    assert.strictEqual(typeof database.sql, 'function');
    const db = database.Db.open(':memory:');
    const name = "a quoted ' project";

    try {
      db.orm.insert(projects).values({ name, created_at: 1n, updated_at: 1n }).run();
      assert.strictEqual(
        db.orm.select().from(projects).where(database.eq(projects.name, name)).get()?.name,
        name
      );
      const query: database.SQL = database.sql`SELECT ${name} AS value`;

      assert.strictEqual(db.orm.get<{ value: string }>(query)?.value, name);
    } finally {
      db.close();
    }
  }
);

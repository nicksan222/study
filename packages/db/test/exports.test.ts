import { test } from '@study/testing';

import * as database from '../src/index.ts';
import { projects } from '../src/schema.ts';

test.stable(
  'database facade executes parameterized queries and schema predicates on its connection',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    assert.strictEqual(typeof database.sql, 'function');
    const location = await databases();
    const db = await location.open();
    const name = "a quoted ' project";

    {
      db.orm.insert(projects).values({ name, created_at: 1n, updated_at: 1n }).run();
      assert.strictEqual(
        db.orm.select().from(projects).where(database.eq(projects.name, name)).get()?.name,
        name
      );
      const query: database.SQL = database.sql`SELECT ${name} AS value`;

      assert.strictEqual(db.orm.get<{ value: string }>(query)?.value, name);
    }
  }
);

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { Db } from '../src/db.ts';
import { createTestDatabase } from '../src/testing.ts';

test('snapshot checks build one trusted reference but inspect every candidate', async (t) => {
  const location = createTestDatabase();
  const db = location.open();
  const target = join(location.dir, 'snapshot.sqlite');
  const open = t.mock.method(Db, 'open');

  try {
    await db.snapshot(target);

    for (let index = 0; index < 3; index++)
      assert.equal(Db.validateSnapshot(target), db.schemaIdentity());

    assert.equal(open.mock.calls.filter((call) => call.arguments[0] === ':memory:').length, 1);

    const candidate = Db.openSnapshot(target);

    try {
      candidate.exec("UPDATE __drizzle_migrations SET hash='tampered'");
    } finally {
      candidate.close();
    }

    assert.throws(() => Db.validateSnapshot(target), /Unsupported snapshot schema/);
    assert.equal(Db.validateSnapshot(location.path), db.schemaIdentity());
    assert.equal(open.mock.calls.filter((call) => call.arguments[0] === ':memory:').length, 1);
  } finally {
    db.close();
    location.cleanup();
  }
});

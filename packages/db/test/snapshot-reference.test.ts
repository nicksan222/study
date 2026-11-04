import { join } from 'node:path';

import { testStable } from '@study/testing/vitest';
import { assert, vi } from 'vite-plus/test';

import { Db } from '../src/db.ts';
import { createTestDatabase } from '../src/testing.ts';

testStable('snapshot checks build one trusted reference but inspect every candidate', async () => {
  const location = createTestDatabase();
  const db = location.open();
  const target = join(location.dir, 'snapshot.sqlite');
  const open = vi.spyOn(Db, 'open');

  try {
    await db.snapshot(target);

    for (let index = 0; index < 3; index++)
      assert.strictEqual(Db.validateSnapshot(target), db.schemaIdentity());

    assert.strictEqual(open.mock.calls.filter((call) => call[0] === ':memory:').length, 1);

    const candidate = Db.openSnapshot(target);

    try {
      candidate.exec("UPDATE __drizzle_migrations SET hash='tampered'");
    } finally {
      candidate.close();
    }

    assert.throws(() => Db.validateSnapshot(target), /Unsupported snapshot schema/);
    assert.strictEqual(Db.validateSnapshot(location.path), db.schemaIdentity());
    assert.strictEqual(open.mock.calls.filter((call) => call[0] === ':memory:').length, 1);
  } finally {
    open.mockRestore();
    db.close();
    location.cleanup();
  }
});

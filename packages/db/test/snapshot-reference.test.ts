import { BunPath } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { Effect, Path } from 'effect';
import { assert, expect, vi } from 'vite-plus/test';

import { Db } from '../src/db.ts';
import { createTestDatabase } from '../src/testing.ts';

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

testStable('snapshot checks build one trusted reference but inspect every candidate', async () => {
  const location = await createTestDatabase();
  const db = await location.open();
  const target = join(location.dir, 'snapshot.sqlite');
  const open = vi.spyOn(Db, 'open');

  try {
    await db.snapshot(target);

    for (let index = 0; index < 3; index++)
      assert.strictEqual(await Db.validateSnapshot(target), db.schemaIdentity());

    assert.strictEqual(open.mock.calls.filter((call) => call[0] === ':memory:').length, 1);

    const candidate = await Db.openSnapshot(target);

    try {
      candidate.exec("UPDATE __drizzle_migrations SET hash='tampered'");
    } finally {
      candidate.close();
    }

    await expect(Db.validateSnapshot(target)).rejects.toThrow(/Unsupported snapshot schema/);
    assert.strictEqual(await Db.validateSnapshot(location.path), db.schemaIdentity());
    assert.strictEqual(open.mock.calls.filter((call) => call[0] === ':memory:').length, 1);
  } finally {
    open.mockRestore();
    db.close();
    await location.cleanup();
  }
});

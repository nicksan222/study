import { BunPath } from '@effect/platform-bun';
import { test } from '@study/testing';
import { Effect, Path } from 'effect';

import { Db } from '../src/db.ts';

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

test.server.stable(
  'snapshot checks build one trusted reference but inspect every candidate',
  async ({ onTestFinished, createTestDatabase, vi, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const location = await createTestDatabase();

    onTestFinished(() => location.cleanup());
    const db = await location.open();
    const target = join(location.dir, 'snapshot.sqlite');
    const open = vi.spyOn(Db, 'open');

    try {
      await db.snapshot(target);

      for (let index = 0; index < 3; index++)
        assert.strictEqual(await Db.validateSnapshot(target), db.schemaIdentity());

      assert.strictEqual(new Set(open.mock.calls.map((call) => call[0])).size, 1);

      const candidate = await Db.openSnapshot(target);

      try {
        candidate.exec("UPDATE __drizzle_migrations SET hash='tampered'");
      } finally {
        candidate.close();
      }

      await expect(Db.validateSnapshot(target)).rejects.toThrow(/Unsupported snapshot schema/);
      assert.strictEqual(await Db.validateSnapshot(location.path), db.schemaIdentity());
      assert.strictEqual(new Set(open.mock.calls.map((call) => call[0])).size, 1);
    } finally {
      open.mockRestore();
    }
  }
);

import { BunPath } from '@effect/platform-bun';
import { test } from '@study/testing';
import { Effect, Path } from 'effect';

import { Db } from '../src/db.ts';

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

test.stable(
  'snapshot checks build one trusted reference but inspect every candidate',
  async ({ onTestFinished }) => {
    const location = await test.createTestDatabase();

    onTestFinished(() => location.cleanup());
    const db = await location.open();
    const target = join(location.dir, 'snapshot.sqlite');
    const open = test.vi.spyOn(Db, 'open');

    try {
      await db.snapshot(target);

      for (let index = 0; index < 3; index++)
        test.assert.strictEqual(await Db.validateSnapshot(target), db.schemaIdentity());

      test.assert.strictEqual(new Set(open.mock.calls.map((call) => call[0])).size, 1);

      const candidate = await Db.openSnapshot(target);

      try {
        candidate.exec("UPDATE __drizzle_migrations SET hash='tampered'");
      } finally {
        candidate.close();
      }

      await test.expect(Db.validateSnapshot(target)).rejects.toThrow(/Unsupported snapshot schema/);
      test.assert.strictEqual(await Db.validateSnapshot(location.path), db.schemaIdentity());
      test.assert.strictEqual(new Set(open.mock.calls.map((call) => call[0])).size, 1);
    } finally {
      open.mockRestore();
    }
  }
);

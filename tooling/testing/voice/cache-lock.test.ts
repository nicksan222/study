import { test } from '@study/testing';
import { Effect } from 'effect';

import { withFixtureCacheLock } from './cache-lock.ts';

test.unit.stable(
  'fixture preparation holds a cross-process lock while work is suspended',
  async ({ expect, temporaryDirectory, spawnTestProcessSync, withinTestDeadline }) => {
    const { path: directory } = await temporaryDirectory();
    const lockPath = `${directory}/.prepare.lock`;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const preparation = Effect.runPromise(
      withFixtureCacheLock(
        lockPath,
        Effect.promise(async () => {
          entered.resolve();
          await release.promise;
        })
      )
    );
    const tryLockInChild = () =>
      spawnTestProcessSync([
        process.execPath,
        '-e',
        `import { Database, SQLiteError } from 'bun:sqlite';
      using db = new Database(process.argv[1]);
      try {
        db.run('BEGIN IMMEDIATE');
      } catch (error) {
        if (!(error instanceof SQLiteError) || error.code !== 'SQLITE_BUSY') throw error;
        process.exitCode = 2;
      }`,
        lockPath
      ]);

    try {
      await withinTestDeadline(entered.promise);
      const locked = tryLockInChild();

      expect(locked.exitCode, locked.stderr.toString()).toBe(2);
    } finally {
      release.resolve();
      await preparation;
    }

    const unlocked = tryLockInChild();

    expect(unlocked.exitCode, unlocked.stderr.toString()).toBe(0);
  }
);

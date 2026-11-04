/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Injects real filesystem failures at staging, recovery retention and settlement.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reopens repeatedly to assert old-or-new activation and truthful recovery inventory.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only temporary fixture paths are blocked; production integrity and ownership stay        │
 * │ active.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Db, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { ManagedBackups } from '#server/platform/database/backups';
import { acquireDatabaseOwnership } from '#server/platform/database/ownership';
import { backupPolicy } from '#server/runtime/backups';
import { acceptance, backupFixture, createDocument } from '#testing/managed-backups';

async function stagedFixture() {
  const f = await backupFixture();

  try {
    await createDocument(f.app, 'Restored publication');

    const api = await f.api();

    const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

    await createDocument(f.app, 'Current independent publication');

    const before = f.app.store.db.contentIdentity();

    const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));

    return { f, api, backup, before, preview, root: f.location.path + '.backups' };
  } catch (cause) {
    await f.close();

    throw cause;
  }
}

testStable(
  'failed staging write keeps the exact preview retryable and preserves the active target',
  async () => {
    const { f, api, before, preview, root } = await stagedFixture();

    try {
      const blocker = join(root, 'restore.sqlite.writing');

      mkdirSync(blocker);
      await expect(
        f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)))
      ).rejects.toSatisfy(() => true);
      assert.strictEqual(f.app.store.db.contentIdentity(), before);
      assert.ok((await f.app.nativeRuntime.runPromise(api.restoreStatus())).state === 'idle');
      assert.ok(existsSync(join(root, 'scratch.sqlite')) === false);
      rmSync(blocker, { recursive: true });
      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
      await f.reopen();
      await f.reopen();
      assert.strictEqual(f.app.store.db.orm.select().from(s.study_documents).all().length, 1);
      assert.ok(
        (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state === 'applied'
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'recovery-copy preparation failure preserves old state and failed discard remains retryable',
  async () => {
    const { f, api, before, preview, root } = await stagedFixture();

    try {
      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));

      const blocker = join(root, 'previous.sqlite');

      mkdirSync(blocker);
      await f.reopen();
      await f.reopen();

      const reopened = await f.api();

      assert.strictEqual(f.app.store.db.contentIdentity(), before);
      expect(await f.app.nativeRuntime.runPromise(reopened.restoreStatus())).toStrictEqual({
        state: 'activation-failed',
        backupId: preview.backup.id,
        recoveryCopy: true
      });
      await expect(
        f.app.nativeRuntime.runPromise(reopened.discardRestoreRecovery())
      ).rejects.toSatisfy(() => true);
      assert.ok(existsSync(join(root, 'restore.json')) === true);
      rmSync(blocker, { recursive: true });
      await f.app.nativeRuntime.runPromise(reopened.discardRestoreRecovery());
      expect(await f.app.nativeRuntime.runPromise(reopened.restoreStatus())).toStrictEqual({
        state: 'idle',
        backupId: null,
        recoveryCopy: false
      });

      const retry = await f.app.nativeRuntime.runPromise(
        reopened.previewRestore({ id: preview.backup.id })
      );

      await f.app.nativeRuntime.runPromise(reopened.acceptRestore(acceptance(retry)));
      await f.reopen();
      assert.strictEqual(f.app.store.db.orm.select().from(s.study_documents).all().length, 1);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'post-rename journal failure aborts startup and reconciles the applied identity on later restarts',
  async () => {
    const { f, api, preview, root } = await stagedFixture();

    try {
      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
      await f.suspend();

      const ownership = await acquireDatabaseOwnership(f.location.path);

      const blocker = join(root, 'restore.json.writing');

      try {
        await expect(
          ManagedBackups.activate(ownership.path, {
            ...backupPolicy,
            async validate(db) {
              await backupPolicy.validate(db);
              // The validated candidate is still staged. A real OS error will occur only when
              // durable journal settlement tries to remove this directory after replacement.
              mkdirSync(blocker);
            }
          })
        ).rejects.toSatisfy(() => true);
        assert.ok(existsSync(join(root, 'previous.sqlite')) === true);
        assert.ok(existsSync(join(root, 'restore.sqlite')) === false);
      } finally {
        await ownership.release();
        rmSync(blocker, { recursive: true, force: true });
      }

      await f.reopen();

      const identity = f.app.store.db.contentIdentity();

      assert.strictEqual(f.app.store.db.orm.select().from(s.study_documents).all().length, 1);
      await f.reopen();
      assert.strictEqual(f.app.store.db.contentIdentity(), identity);

      const reopened = await f.api();

      assert.ok(
        (await f.app.nativeRuntime.runPromise(reopened.restoreStatus())).state === 'applied'
      );

      const next = await f.app.nativeRuntime.runPromise(reopened.createBackup());

      const another = await f.app.nativeRuntime.runPromise(
        reopened.previewRestore({ id: next.id })
      );

      await expect(
        f.app.nativeRuntime.runPromise(reopened.acceptRestore(acceptance(another)))
      ).rejects.toSatisfy(() => true);
      await f.app.nativeRuntime.runPromise(reopened.discardRestoreRecovery());
      assert.strictEqual(f.app.store.db.contentIdentity(), identity);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'startup cleans interrupted private scratch and known writing files without removing artifacts',
  async () => {
    const f = await backupFixture();

    try {
      const api = await f.api();

      const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

      const root = f.location.path + '.backups';

      for (const name of [
        'scratch.sqlite',
        'scratch.sqlite-wal',
        'scratch.sqlite-shm',
        'restore.sqlite',
        'restore.sqlite.writing',
        'restore.json.writing',
        backup.id + '.studybackup.writing'
      ])
        writeFileSync(join(root, name), 'private interrupted bytes');

      await f.reopen();
      expect(readdirSync(root)).toStrictEqual([backup.id + '.studybackup']);
      assert.strictEqual(
        (await f.app.nativeRuntime.runPromise((await f.api()).backups()))[0]?.id,
        backup.id
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'a real SQLite read lock prevents the journal transition without replacing the current target',
  async () => {
    const { f, api, before, preview } = await stagedFixture();

    let reader: Db | undefined;

    try {
      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
      await f.suspend();

      const ownership = await acquireDatabaseOwnership(f.location.path);

      try {
        await ManagedBackups.activate(ownership.path, {
          ...backupPolicy,
          async validate(db) {
            await backupPolicy.validate(db);
            reader = Db.openSnapshot(ownership.path);
            reader.exec('BEGIN; SELECT count(*) FROM study_documents;');
          }
        });
      } finally {
        reader?.exec('ROLLBACK;');
        reader?.close();
        await ownership.release();
      }

      await f.reopen();
      assert.strictEqual(f.app.store.db.contentIdentity(), before);
      assert.ok(
        (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state ===
          'activation-failed'
      );
      await f.reopen();
      assert.strictEqual(f.app.store.db.contentIdentity(), before);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'failed atomic rename leaves old data and pending intent for an explicit filesystem retry',
  async () => {
    const { renameSync } = await import('node:fs');

    const { f, api, before, preview, root } = await stagedFixture();

    const staged = join(root, 'restore.sqlite');

    const saved = join(root, 'fixture-staged.sqlite');

    try {
      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
      await f.suspend();

      const ownership = await acquireDatabaseOwnership(f.location.path);

      try {
        await expect(
          ManagedBackups.activate(ownership.path, {
            ...backupPolicy,
            async validate(db) {
              await backupPolicy.validate(db);
              renameSync(staged, saved);
              mkdirSync(staged);
            }
          })
        ).rejects.toSatisfy(() => true);

        const current = Db.openSnapshot(ownership.path);

        try {
          assert.strictEqual(current.contentIdentity(), before);
          assert.strictEqual(
            current.orm.get<{ n: bigint }>(sql`SELECT count(*) n FROM study_documents`)!.n,
            2n
          );
        } finally {
          current.close();
        }
      } finally {
        await ownership.release();
        rmSync(staged, { force: true, recursive: true });

        if (existsSync(saved)) renameSync(saved, staged);
      }

      await f.reopen();
      assert.strictEqual(f.app.store.db.orm.select().from(s.study_documents).all().length, 1);
      await f.reopen();
      assert.ok(
        (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state === 'applied'
      );
    } finally {
      rmSync(saved, { force: true });
      await f.close();
    }
  }
);

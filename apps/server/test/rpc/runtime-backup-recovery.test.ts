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

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { Db, sql } from '@study/db';
import * as s from '@study/db/schema';

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

test('failed staging write keeps the exact preview retryable and preserves the active target', async () => {
  const { f, api, before, preview, root } = await stagedFixture();

  try {
    const blocker = join(root, 'restore.sqlite.writing');

    mkdirSync(blocker);
    await assert.rejects(f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview))));
    assert.equal(f.app.store.db.contentIdentity(), before);
    assert.equal((await f.app.nativeRuntime.runPromise(api.restoreStatus())).state, 'idle');
    assert.equal(existsSync(join(root, 'scratch.sqlite')), false);
    rmSync(blocker, { recursive: true });
    await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
    await f.reopen();
    await f.reopen();
    assert.equal(f.app.store.db.orm.select().from(s.materials).all().length, 1);
    assert.equal(
      (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state,
      'applied'
    );
  } finally {
    await f.close();
  }
});

test('recovery-copy preparation failure preserves old state and failed discard remains retryable', async () => {
  const { f, api, before, preview, root } = await stagedFixture();

  try {
    await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));

    const blocker = join(root, 'previous.sqlite');

    mkdirSync(blocker);
    await f.reopen();
    await f.reopen();

    const reopened = await f.api();

    assert.equal(f.app.store.db.contentIdentity(), before);
    assert.deepEqual(await f.app.nativeRuntime.runPromise(reopened.restoreStatus()), {
      state: 'activation-failed',
      backupId: preview.backup.id,
      recoveryCopy: true
    });
    await assert.rejects(f.app.nativeRuntime.runPromise(reopened.discardRestoreRecovery()));
    assert.equal(existsSync(join(root, 'restore.json')), true);
    rmSync(blocker, { recursive: true });
    await f.app.nativeRuntime.runPromise(reopened.discardRestoreRecovery());
    assert.deepEqual(await f.app.nativeRuntime.runPromise(reopened.restoreStatus()), {
      state: 'idle',
      backupId: null,
      recoveryCopy: false
    });

    const retry = await f.app.nativeRuntime.runPromise(
      reopened.previewRestore({ id: preview.backup.id })
    );

    await f.app.nativeRuntime.runPromise(reopened.acceptRestore(acceptance(retry)));
    await f.reopen();
    assert.equal(f.app.store.db.orm.select().from(s.materials).all().length, 1);
  } finally {
    await f.close();
  }
});

test('post-rename journal failure aborts startup and reconciles the applied identity on later restarts', async () => {
  const { f, api, preview, root } = await stagedFixture();

  try {
    await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
    await f.suspend();

    const ownership = await acquireDatabaseOwnership(f.location.path);

    const blocker = join(root, 'restore.json.writing');

    try {
      await assert.rejects(
        ManagedBackups.activate(ownership.path, {
          ...backupPolicy,
          async validate(db) {
            await backupPolicy.validate(db);
            // The validated candidate is still staged. A real OS error will occur only when
            // durable journal settlement tries to remove this directory after replacement.
            mkdirSync(blocker);
          }
        })
      );
      assert.equal(existsSync(join(root, 'previous.sqlite')), true);
      assert.equal(existsSync(join(root, 'restore.sqlite')), false);
    } finally {
      await ownership.release();
      rmSync(blocker, { recursive: true, force: true });
    }

    await f.reopen();

    const identity = f.app.store.db.contentIdentity();

    assert.equal(f.app.store.db.orm.select().from(s.materials).all().length, 1);
    await f.reopen();
    assert.equal(f.app.store.db.contentIdentity(), identity);

    const reopened = await f.api();

    assert.equal((await f.app.nativeRuntime.runPromise(reopened.restoreStatus())).state, 'applied');

    const next = await f.app.nativeRuntime.runPromise(reopened.createBackup());

    const another = await f.app.nativeRuntime.runPromise(reopened.previewRestore({ id: next.id }));

    await assert.rejects(
      f.app.nativeRuntime.runPromise(reopened.acceptRestore(acceptance(another)))
    );
    await f.app.nativeRuntime.runPromise(reopened.discardRestoreRecovery());
    assert.equal(f.app.store.db.contentIdentity(), identity);
  } finally {
    await f.close();
  }
});

test('startup cleans interrupted private scratch and known writing files without removing artifacts', async () => {
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
    assert.deepEqual(readdirSync(root), [backup.id + '.studybackup']);
    assert.equal(
      (await f.app.nativeRuntime.runPromise((await f.api()).backups()))[0]?.id,
      backup.id
    );
  } finally {
    await f.close();
  }
});

test('a real SQLite read lock prevents the journal transition without replacing the current target', async () => {
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
          reader.exec('BEGIN; SELECT count(*) FROM materials;');
        }
      });
    } finally {
      reader?.exec('ROLLBACK;');
      reader?.close();
      await ownership.release();
    }

    await f.reopen();
    assert.equal(f.app.store.db.contentIdentity(), before);
    assert.equal(
      (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state,
      'activation-failed'
    );
    await f.reopen();
    assert.equal(f.app.store.db.contentIdentity(), before);
  } finally {
    await f.close();
  }
});

test('failed atomic rename leaves old data and pending intent for an explicit filesystem retry', async () => {
  const { renameSync } = await import('node:fs');

  const { f, api, before, preview, root } = await stagedFixture();

  const staged = join(root, 'restore.sqlite');

  const saved = join(root, 'fixture-staged.sqlite');

  try {
    await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
    await f.suspend();

    const ownership = await acquireDatabaseOwnership(f.location.path);

    try {
      await assert.rejects(
        ManagedBackups.activate(ownership.path, {
          ...backupPolicy,
          async validate(db) {
            await backupPolicy.validate(db);
            renameSync(staged, saved);
            mkdirSync(staged);
          }
        })
      );

      const current = Db.openSnapshot(ownership.path);

      try {
        assert.equal(current.contentIdentity(), before);
        assert.equal(current.orm.get<{ n: bigint }>(sql`SELECT count(*) n FROM materials`)!.n, 2n);
      } finally {
        current.close();
      }
    } finally {
      await ownership.release();
      rmSync(staged, { force: true, recursive: true });

      if (existsSync(saved)) renameSync(saved, staged);
    }

    await f.reopen();
    assert.equal(f.app.store.db.orm.select().from(s.materials).all().length, 1);
    await f.reopen();
    assert.equal(
      (await f.app.nativeRuntime.runPromise((await f.api()).restoreStatus())).state,
      'applied'
    );
  } finally {
    rmSync(saved, { force: true });
    await f.close();
  }
});

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers canonical App path ownership across acquisition, shutdown and process loss. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps startup scratch and pending restore state private to the current runtime owner.  │
 * │ - Exercises alias rejection, failed acquisition and kernel-released child lifetimes.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ All paths are temporary; external SQLite writers do not participate in App ownership.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StudyError } from '@study/contracts/errors';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';

import { acquireDatabaseOwnership } from '#server/platform/database/ownership';
import { App } from '#server/runtime/index';
import { acceptance, backupFixture, createDocument } from '#testing/managed-backups';
import { inTestPhase } from '#testing/progress';

async function childOwner(path: string) {
  const child = fork(
    fileURLToPath(new URL('../testing/database-owner-child.ts', import.meta.url)),
    [path],
    {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    }
  );

  const exited = once(child, 'exit');

  const [message] = await Promise.race([
    once(child, 'message'),
    exited.then((): never => {
      throw new Error('Owner child exited before reporting acquisition');
    })
  ]);

  return { child, exited, message };
}

testStable(
  'same-path startup rejects before touching an active backup scratch or restore journal',
  async () => {
    const f = await backupFixture();

    try {
      const root = f.location.path + '.backups';

      mkdirSync(root);

      const scratch = join(root, 'scratch.sqlite');

      const journal = join(root, 'restore.json');

      writeFileSync(scratch, 'active snapshot');
      writeFileSync(journal, 'active journal');
      await assert.rejects(
        App.open({ path: f.location.path }),
        (error: unknown) => error instanceof StudyError && error.kind === 'transient'
      );
      assert.equal(readFileSync(scratch, 'utf8'), 'active snapshot');
      assert.equal(readFileSync(journal, 'utf8'), 'active journal');
    } finally {
      await f.close();
    }
  }
);

testStable(
  'canonical relative and symlink aliases share ownership and hardlinks are rejected',
  async () => {
    const f = await backupFixture();

    try {
      const alias = join(f.location.dir, 'alias.sqlite');

      symlinkSync(f.location.path, alias);

      for (const path of [alias, relative(process.cwd(), f.location.path)])
        await assert.rejects(
          acquireDatabaseOwnership(path),
          (error: unknown) => error instanceof StudyError && error.kind === 'transient'
        );

      const hard = join(f.location.dir, 'hard.sqlite');

      linkSync(f.location.path, hard);
      await assert.rejects(
        acquireDatabaseOwnership(hard),
        (error: unknown) => error instanceof StudyError && error.kind === 'unsupported'
      );
    } finally {
      await f.close();
    }
  }
);

testStable('distinct paths and in-memory instances have independent path leases', async () => {
  const location = createTestDatabase();

  const leases: Awaited<ReturnType<typeof acquireDatabaseOwnership>>[] = [];

  try {
    for (const path of [location.path, location.path + '.other', ':memory:', ':memory:'])
      leases.push(await acquireDatabaseOwnership(path));

    assert.equal(leases.length, 4);
  } finally {
    await Promise.all(leases.map((lease) => lease.release()));
    location.cleanup();
  }
});

testStable(
  'failed activation releases ownership so the same canonical target can retry',
  async () => {
    const location = createTestDatabase();

    try {
      const root = location.path + '.backups';

      mkdirSync(root);
      writeFileSync(join(root, 'restore.json'), '{');
      await assert.rejects(App.open({ path: location.path }));
      rmSync(join(root, 'restore.json'));

      const app = await App.open({ path: location.path });

      await app.close();

      const reopened = await App.open({ path: location.path });

      await reopened.close();
    } finally {
      location.cleanup();
    }
  }
);

for (const termination of ['close', 'SIGKILL'] as const)
  testStable(
    `supported private/development App overlap rejects and ${termination} releases ownership`,
    { timeout: 15000 },
    async () => {
      const location = createTestDatabase();

      const owner = await childOwner(location.path);

      try {
        assert.deepEqual(owner.message, { state: 'owned' });

        const contender = await childOwner(location.path);

        try {
          assert.deepEqual(contender.message, { state: 'rejected', kind: 'transient' });
          await contender.exited;
        } finally {
          contender.child.kill('SIGKILL');
        }

        if (termination === 'close') owner.child.send('close');
        else owner.child.kill(termination);

        await owner.exited;

        const app = await App.open({ path: location.path });

        await app.close();
      } finally {
        owner.child.kill('SIGKILL');
        await owner.exited;
        location.cleanup();
      }
    }
  );

testStable(
  'occupied deterministic endpoint fails closed without acquiring an alternate lease',
  async () => {
    const location = createTestDatabase();

    const canonical = join(realpathSync(location.dir), basename(location.path));

    const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;

    const port = 1024 + (createHash('sha256').update(identity).digest().readUInt32BE(0) % 64512);

    const listener = createServer();

    try {
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject);
        listener.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
      });
      await assert.rejects(
        App.open({ path: location.path }),
        (error: unknown) => error instanceof StudyError && error.kind === 'transient'
      );
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      location.cleanup();
    }
  }
);

testStable(
  'a second supported App cannot acquire a target while its restart owner is active',
  async () => {
    const f = await backupFixture();

    try {
      await createDocument(f.app, 'Backup');

      const api = await f.api();

      const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

      await createDocument(f.app, 'Current target');

      const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));

      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
      await f.suspend();

      const opening = App.open({ path: f.location.path });

      const contender = await childOwner(f.location.path);

      const restored = await opening;

      try {
        assert.deepEqual(contender.message, { state: 'rejected', kind: 'transient' });
        await contender.exited;
        assert.equal(restored.store.db.orm.select().from(s.materials).all().length, 1);
      } finally {
        contender.child.kill('SIGKILL');
        await restored.close();
      }
    } finally {
      await f.close();
    }
  }
);

testStable(
  'failed ordinary database acquisition releases its lease and auth owner for retry',
  async () => {
    const location = createTestDatabase();

    try {
      writeFileSync(location.path, 'not a SQLite database');
      await assert.rejects(App.open({ path: location.path }));
      rmSync(location.path);

      const app = await App.open({ path: location.path });

      await app.close();
    } finally {
      location.cleanup();
    }
  }
);

testStable(
  'a competing process cannot remove the real scratch of an in-progress backup',
  // Real App startup and owned backup cleanup use the runner's integration deadline.
  // IPC state and exact scratch bytes establish ownership, not subprocess startup speed.
  async (t) => {
    const { ManagedBackups } = await import('#server/platform/database/backups');

    const { backupPolicy } = await import('#server/runtime/backups');

    const f = await backupFixture(t);

    let entered!: () => void;

    let release!: () => void;

    const prepared = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const owner = new ManagedBackups(f.app.store.db, {
      ...backupPolicy,
      async prepare(db) {
        await backupPolicy.prepare(db);
        entered();
        await gate;
      }
    });

    const creating = inTestPhase(t, 'backup-create', () => owner.create());

    try {
      await inTestPhase(t, 'backup-prepared', () =>
        Promise.race([
          prepared,
          creating.then((): never => {
            throw new Error('Backup completed before reaching the preparation gate');
          })
        ])
      );

      const scratch = f.location.path + '.backups/scratch.sqlite';

      const bytes = readFileSync(scratch);

      const contender = await inTestPhase(t, 'contender-start', () => childOwner(f.location.path));

      try {
        assert.deepEqual(contender.message, { state: 'rejected', kind: 'transient' });
        await inTestPhase(t, 'contender-exit', () => contender.exited);
        assert.deepEqual(readFileSync(scratch), bytes);
      } finally {
        contender.child.kill('SIGKILL');
      }
    } finally {
      release();

      try {
        await creating;
        await owner.close();
      } finally {
        await f.close();
      }
    }
  }
);

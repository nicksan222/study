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

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { StudyError } from '@study/contracts/errors';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem, Path } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { acquireDatabaseOwnership } from '#server/platform/database/ownership';
import { App } from '#server/runtime/index';
import { acceptance, backupFixture, createPage } from '#testing/managed-backups';
import { inTestPhase } from '#testing/progress';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const paths = await Effect.runPromise(Effect.provide(Path.Path, BunPath.layer));

async function childOwner(path: string) {
  let received!: (message: unknown) => void;
  const messagePromise = new Promise<unknown>((resolve) => {
    received = resolve;
  });
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      Bun.fileURLToPath(new URL('../testing/database-owner-child.ts', import.meta.url)),
      path
    ],
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'inherit',
    ipc(message) {
      received(message);
    }
  });
  const exited = child.exited;
  const message = await Promise.race([
    messagePromise,
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

      await Effect.runPromise(fs.makeDirectory(root));

      const scratch = paths.join(root, 'scratch.sqlite');

      const journal = paths.join(root, 'restore.json');

      await Bun.write(scratch, 'active snapshot');
      await Bun.write(journal, 'active journal');
      await expect(App.open({ path: f.location.path })).rejects.toSatisfy(
        (error: unknown) => error instanceof StudyError && error.kind === 'transient'
      );
      assert.ok((await Bun.file(scratch).text()) === 'active snapshot');
      assert.ok((await Bun.file(journal).text()) === 'active journal');
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
      const alias = paths.join(f.location.dir, 'alias.sqlite');

      await Effect.runPromise(fs.symlink(f.location.path, alias));

      for (const path of [alias, paths.relative(process.cwd(), f.location.path)])
        await expect(acquireDatabaseOwnership(path)).rejects.toSatisfy(
          (error: unknown) => error instanceof StudyError && error.kind === 'transient'
        );

      const hard = paths.join(f.location.dir, 'hard.sqlite');

      await Effect.runPromise(fs.link(f.location.path, hard));
      await expect(acquireDatabaseOwnership(hard)).rejects.toSatisfy(
        (error: unknown) => error instanceof StudyError && error.kind === 'unsupported'
      );
    } finally {
      await f.close();
    }
  }
);

testStable('distinct paths and in-memory instances have independent path leases', async () => {
  const location = await createTestDatabase();

  const leases: Awaited<ReturnType<typeof acquireDatabaseOwnership>>[] = [];

  try {
    for (const path of [location.path, location.path + '.other', ':memory:', ':memory:'])
      leases.push(await acquireDatabaseOwnership(path));

    assert.strictEqual(leases.length, 4);
  } finally {
    await Promise.all(leases.map((lease) => lease.release()));
    await location.cleanup();
  }
});

testStable(
  'failed activation releases ownership so the same canonical target can retry',
  async () => {
    const location = await createTestDatabase();

    try {
      const root = location.path + '.backups';

      await Effect.runPromise(fs.makeDirectory(root));
      await Bun.write(paths.join(root, 'restore.json'), '{');
      await expect(App.open({ path: location.path })).rejects.toSatisfy(() => true);
      await Effect.runPromise(fs.remove(paths.join(root, 'restore.json')));

      const app = await App.open({ path: location.path });

      await app.close();

      const reopened = await App.open({ path: location.path });

      await reopened.close();
    } finally {
      await location.cleanup();
    }
  }
);

for (const termination of ['close', 'SIGKILL'] as const)
  testStable(
    `supported private/development App overlap rejects and ${termination} releases ownership`,
    { timeout: 15000 },
    async () => {
      const location = await createTestDatabase();

      const owner = await childOwner(location.path);

      try {
        expect(owner.message).toStrictEqual({ state: 'owned' });

        const contender = await childOwner(location.path);

        try {
          expect(contender.message).toStrictEqual({ state: 'rejected', kind: 'transient' });
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
        await location.cleanup();
      }
    }
  );

testStable(
  'occupied deterministic endpoint fails closed without acquiring an alternate lease',
  async () => {
    const location = await createTestDatabase();

    const canonical = paths.join(
      await Effect.runPromise(fs.realPath(location.dir)),
      paths.basename(location.path)
    );

    const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;

    const hash = new Bun.CryptoHasher('sha256').update(identity).digest();

    const port =
      1024 + (new DataView(hash.buffer, hash.byteOffset, hash.byteLength).getUint32(0) % 64512);

    const listener = Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } });

    try {
      await expect(App.open({ path: location.path })).rejects.toSatisfy(
        (error: unknown) => error instanceof StudyError && error.kind === 'transient'
      );
    } finally {
      listener.stop();
      await location.cleanup();
    }
  }
);

testStable(
  'a second supported App cannot acquire a target while its restart owner is active',
  async () => {
    const f = await backupFixture();

    try {
      await createPage(f.app, 'Backup');

      const api = await f.api();

      const backup = await f.app.nativeRuntime.runPromise(api.createBackup());

      await createPage(f.app, 'Current target');

      const preview = await f.app.nativeRuntime.runPromise(api.previewRestore({ id: backup.id }));

      await f.app.nativeRuntime.runPromise(api.acceptRestore(acceptance(preview)));
      await f.suspend();

      const opening = App.open({ path: f.location.path });

      const contender = await childOwner(f.location.path);

      const restored = await opening;

      try {
        expect(contender.message).toStrictEqual({ state: 'rejected', kind: 'transient' });
        await contender.exited;
        assert.strictEqual(restored.store.db.orm.select().from(s.pages).all().length, 1);
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
    const location = await createTestDatabase();

    try {
      await Bun.write(location.path, 'not a SQLite database');
      await expect(App.open({ path: location.path })).rejects.toSatisfy(() => true);
      await Effect.runPromise(fs.remove(location.path));

      const app = await App.open({ path: location.path });

      await app.close();
    } finally {
      await location.cleanup();
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

      const bytes = new Uint8Array(await Bun.file(scratch).arrayBuffer());

      const contender = await inTestPhase(t, 'contender-start', () => childOwner(f.location.path));

      try {
        expect(contender.message).toStrictEqual({ state: 'rejected', kind: 'transient' });
        await inTestPhase(t, 'contender-exit', () => contender.exited);
        expect(new Uint8Array(await Bun.file(scratch).arrayBuffer())).toStrictEqual(bytes);
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

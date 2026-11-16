import { BunFileSystem, BunPath } from '@effect/platform-bun';
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
import { StudyError } from '@study/contracts';
import { sql } from '@study/db';
import * as s from '@study/db';
import { test } from '@study/testing';
import { Effect, FileSystem, Path } from 'effect';

import { acquireDatabaseOwnership } from '#server/platform/database/ownership';
import type { App } from '#server/runtime/index';
import { acceptance, backupFixture, createPage } from '#testing/managed-backups';
import { inTestPhase } from '#testing/progress';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const paths = await Effect.runPromise(Effect.provide(Path.Path, BunPath.layer));

async function childOwner(path: string) {
  let received!: (message: unknown) => void;
  const messagePromise = new Promise<unknown>((resolve) => {
    received = resolve;
  });
  const child = test.spawnTestProcess({
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

test.stable(
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
      await test
        .expect(f.location.openApp({ path: f.location.path }))
        .rejects.toSatisfy(
          (error: unknown) => error instanceof StudyError && error.kind === 'transient'
        );
      test.assert.ok((await Bun.file(scratch).text()) === 'active snapshot');
      test.assert.ok((await Bun.file(journal).text()) === 'active journal');
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'canonical relative and symlink aliases share ownership and hardlinks are rejected',
  async () => {
    const f = await backupFixture();

    try {
      const alias = paths.join(f.location.dir, 'alias.sqlite');

      await Effect.runPromise(fs.symlink(f.location.path, alias));

      for (const path of [alias, paths.relative(process.cwd(), f.location.path)])
        await test
          .expect(acquireDatabaseOwnership(path))
          .rejects.toSatisfy(
            (error: unknown) => error instanceof StudyError && error.kind === 'transient'
          );

      const hard = paths.join(f.location.dir, 'hard.sqlite');

      await Effect.runPromise(fs.link(f.location.path, hard));
      await test
        .expect(acquireDatabaseOwnership(hard))
        .rejects.toSatisfy(
          (error: unknown) => error instanceof StudyError && error.kind === 'unsupported'
        );
    } finally {
      await f.close();
    }
  }
);

test.stable('distinct paths and in-memory instances have independent path leases', async () => {
  await using location = await test.createServerFixture();

  const leases: Awaited<ReturnType<typeof acquireDatabaseOwnership>>[] = [];

  try {
    for (const path of [location.path, location.path + '.other', ':memory:', ':memory:'])
      leases.push(await acquireDatabaseOwnership(path));

    test.assert.strictEqual(leases.length, 4);
  } finally {
    await Promise.all(leases.map((lease) => lease.release()));
    await location.close();
  }
});

test.stable(
  'failed activation releases ownership so the same canonical target can retry',
  async () => {
    await using location = await test.createServerFixture();

    try {
      const root = location.path + '.backups';

      await Effect.runPromise(fs.makeDirectory(root));
      await Bun.write(paths.join(root, 'restore.json'), '{');
      await test.expect(location.openApp({ path: location.path })).rejects.toSatisfy(() => true);
      await Effect.runPromise(fs.remove(paths.join(root, 'restore.json')));

      const app = await location.openApp({ path: location.path });

      await app.close();

      const reopened = await location.openApp({ path: location.path });

      await reopened.close();
    } finally {
      await location.close();
    }
  }
);

for (const termination of ['close', 'SIGKILL'] as const)
  test.stable(
    `supported private/development App overlap rejects and ${termination} releases ownership`,
    { timeout: 15000 },
    async () => {
      await using location = await test.createServerFixture();

      const owner = await childOwner(location.path);

      try {
        test.expect(owner.message).toStrictEqual({ state: 'owned' });

        const contender = await childOwner(location.path);

        try {
          test.expect(contender.message).toStrictEqual({ state: 'rejected', kind: 'transient' });
          await contender.exited;
        } finally {
          contender.child.kill('SIGKILL');
        }

        if (termination === 'close') owner.child.send('close');
        else owner.child.kill(termination);

        await owner.exited;

        const app = await location.openApp({ path: location.path });

        await app.close();
      } finally {
        owner.child.kill('SIGKILL');
        await owner.exited;
        await location.close();
      }
    }
  );

test.stable('an unrelated TCP listener does not block Linux database ownership', async () => {
  await using location = await test.createServerFixture();

  const canonical = paths.join(
    await Effect.runPromise(fs.realPath(location.dir)),
    paths.basename(location.path)
  );

  // Reserve first, then find a legacy hash preimage so setup cannot race another listener.
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  let path = canonical;

  for (let candidate = 0; ; candidate++) {
    path = `${canonical}.${candidate}`;
    const identity = process.platform === 'win32' ? path.toLowerCase() : path;
    const hash = new Bun.CryptoHasher('sha256').update(identity).digest('hex');
    const port = 1024 + (Number.parseInt(hash.slice(0, 8), 16) % 64512);

    if (port === listener.port) break;
  }

  try {
    if (process.platform === 'linux') {
      const app = await location.openApp({ path });

      try {
        await test
          .expect(acquireDatabaseOwnership(path))
          .rejects.toSatisfy(
            (error: unknown) => error instanceof StudyError && error.kind === 'transient'
          );
      } finally {
        await app.close();
      }
    } else {
      await test
        .expect(location.openApp({ path }))
        .rejects.toSatisfy(
          (error: unknown) => error instanceof StudyError && error.kind === 'transient'
        );
    }
  } finally {
    listener.stop();
    await location.close();
  }
});

test.stable(
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

      const opening = f.location.openApp({ path: f.location.path });

      const contender = await childOwner(f.location.path);

      const restored = await opening;

      try {
        test.expect(contender.message).toStrictEqual({ state: 'rejected', kind: 'transient' });
        await contender.exited;
        test.assert.strictEqual(restored.store.db.orm.select().from(s.pages).all().length, 1);
      } finally {
        contender.child.kill('SIGKILL');
        await restored.close();
      }
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'failed ordinary database acquisition releases its lease and auth owner for retry',
  async () => {
    await using location = await test.createServerFixture();

    try {
      await Bun.write(location.path, 'not a SQLite database');
      await test.expect(location.openApp({ path: location.path })).rejects.toSatisfy(() => true);
      await Effect.runPromise(fs.remove(location.path));

      const app = await location.openApp({ path: location.path });

      await app.close();
    } finally {
      await location.close();
    }
  }
);

test.stable(
  'a competing process cannot remove the real scratch of an in-progress backup',
  // Real App startup and owned backup cleanup use the runner's integration deadline.
  // IPC state and exact scratch bytes establish ownership, not subprocess startup speed.
  async ({ task: _task }) => {
    const { ManagedBackups } = await import('#server/platform/database/backups');

    const { backupPolicy } = await import('#server/runtime/backups');

    const f = await backupFixture();

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

    const creating = inTestPhase(undefined, 'backup-create', () => owner.create());

    try {
      await inTestPhase(undefined, 'backup-prepared', () =>
        Promise.race([
          prepared,
          creating.then((): never => {
            throw new Error('Backup completed before reaching the preparation gate');
          })
        ])
      );

      const scratch = f.location.path + '.backups/scratch.sqlite';

      const bytes = new Uint8Array(await Bun.file(scratch).arrayBuffer());

      const contender = await inTestPhase(undefined, 'contender-start', () =>
        childOwner(f.location.path)
      );

      try {
        test.expect(contender.message).toStrictEqual({ state: 'rejected', kind: 'transient' });
        await inTestPhase(undefined, 'contender-exit', () => contender.exited);
        test.expect(new Uint8Array(await Bun.file(scratch).arrayBuffer())).toStrictEqual(bytes);
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

test.stable(
  'future official migration history blocks startup without changing data or retaining ownership',
  async () => {
    await using location = await test.createServerFixture();
    let app: App | undefined;

    try {
      app = await location.openApp({ path: location.path });
      await app.close();
      app = undefined;
      const db = await location.openDb();

      db.orm.run(
        sql`INSERT INTO cluster_migrations (migration_id,name,created_at) VALUES (999999,'future-protocol',CURRENT_TIMESTAMP)`
      );
      db.close();
      await test
        .expect(location.openApp({ path: location.path }))
        .rejects.toSatisfy(
          (error: unknown) => error instanceof StudyError && error.kind === 'unsupported'
        );
      const owner = await acquireDatabaseOwnership(location.path);

      await owner.release();
      const retained = await location.openDb(location.path);

      test.assert.equal(
        retained.orm.all(sql`SELECT name FROM cluster_migrations WHERE migration_id=999999`)[0]
          ?.name,
        'future-protocol'
      );
      retained.orm.run(sql`DELETE FROM cluster_migrations WHERE migration_id=999999`);
      retained.close();
      app = await location.openApp({ path: location.path });
    } finally {
      await app?.close();
      await location.close();
    }
  }
);

import { BunFileSystem } from '@effect/platform-bun';
import { BunPath } from '@effect/platform-bun';
import { Db, sql } from '@study/db';
import { projects, source_blobs, sources, page_versions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { acquireDatabaseOwnership } from '@study/server/runtime/ownership';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem, Path } from 'effect';
import { expect } from 'vite-plus/test';

import { seedDatabase } from './seed.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

testStable(
  'replaces all old content with readable, linked pages and repeatable study data',
  async () => {
    const location = await createTestDatabase();
    let db = await location.open();

    db.orm
      .insert(projects)
      .values({ name: 'Old private subject', created_at: 1n, updated_at: 1n })
      .run();
    db.close();

    try {
      await seedDatabase(location.path);
      db = await location.open();
      expect(db.orm.select().from(projects).all()).toHaveLength(5);
      expect(db.orm.all(sql`SELECT * FROM projects WHERE name = 'Old private subject'`)).toEqual(
        []
      );

      const imported = db.orm.select().from(sources).all();

      expect(imported).toHaveLength(15);
      expect(
        db.orm
          .select()
          .from(source_blobs)
          .all()
          .every((row) => row.bytes.length > 0)
      ).toBe(true);
      expect(
        db.orm
          .select()
          .from(page_versions)
          .all()
          .every((row) => row.status === 'published')
      ).toBe(true);
      expect(db.orm.get(sql`SELECT count(*) n FROM pages`)?.n).toBe(10n);
      expect(db.orm.get(sql`SELECT count(*) n FROM material_flashcard_entries`)?.n).toBe(20n);
      expect(db.orm.get(sql`SELECT count(*) n FROM material_quiz_questions`)?.n).toBe(15n);
      expect(db.orm.get(sql`SELECT count(*) n FROM messages`)?.n).toBe(100n);
      expect(
        db.orm
          .all(sql`SELECT project_id, count(*) n FROM project_notes GROUP BY project_id`)
          .map((row) => row.n)
      ).toEqual([10n, 10n, 10n, 10n, 10n]);
      expect(
        db.orm
          .all(sql`SELECT DISTINCT kind FROM material_quiz_questions`)
          .map((row) => row.kind)
          .sort()
      ).toEqual(['multiple_choice', 'open', 'single_choice']);
      expect(
        db.orm
          .all(sql`SELECT DISTINCT kind FROM blocks`)
          .map((row) => row.kind)
          .sort()
      ).toEqual(['code', 'heading', 'math', 'paragraph', 'table']);
      expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(db.orm.get(sql`PRAGMA integrity_check`)?.integrity_check).toBe('ok');

      const names = imported.map((row) => row.name);

      db.close();
      await seedDatabase(location.path);
      db = await location.open();
      expect(
        db.orm
          .select()
          .from(sources)
          .all()
          .map((row) => row.name)
      ).toEqual(names);
      expect(db.orm.get(sql`SELECT count(*) n FROM projects`)?.n).toBe(5n);
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);

testStable('refuses an owned database without modifying it', async () => {
  const location = await createTestDatabase();
  const db = await location.open();

  db.close();

  const before = new Uint8Array(await Bun.file(location.path).arrayBuffer());
  const owner = await acquireDatabaseOwnership(location.path);

  try {
    await expect(seedDatabase(location.path)).rejects.toMatchObject({ kind: 'transient' });
    expect(new Uint8Array(await Bun.file(location.path).arrayBuffer())).toEqual(before);
    expect(await Effect.runPromise(fs.readDirectory(location.dir))).toEqual([
      location.path.split('/').at(-1)
    ]);
  } finally {
    await owner.release();
    await location.cleanup();
  }
});

testStable('creates a missing parent directory and leaves no staging database', async () => {
  const location = await createTestDatabase();
  const path = join(location.dir, 'nested', 'study.sqlite');

  try {
    await seedDatabase(path);
    expect(await Bun.file(path).exists()).toBe(true);
    expect(await Effect.runPromise(fs.readDirectory(join(location.dir, 'nested')))).toEqual([
      'study.sqlite'
    ]);
    expect(await Db.validateSnapshot(path)).toBeTruthy();
  } finally {
    await location.cleanup();
  }
});

testStable('bun seed honors STUDY_DATABASE and help leaves its target untouched', async () => {
  const location = await createTestDatabase();
  const env = { ...process.env, STUDY_DATABASE: location.path };

  try {
    const help = Bun.spawnSync(['bun', 'seed', '--help'], { env });

    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain('STUDY_DATABASE');
    expect(await Bun.file(location.path).exists()).toBe(false);
    expect(Bun.spawnSync(['bun', 'seed', '--unknown'], { env }).exitCode).not.toBe(0);
    expect(await Bun.file(location.path).exists()).toBe(false);
    expect(Bun.spawnSync(['bun', 'seed'], { env }).exitCode).toBe(0);

    const db = await location.open();

    try {
      expect(db.orm.select().from(projects).all()).toHaveLength(5);
    } finally {
      db.close();
    }
  } finally {
    await location.cleanup();
  }
});

testStable('reset does not migrate the database being discarded', async () => {
  const location = await createTestDatabase();
  const db = await location.open();

  db.exec('DROP TABLE __drizzle_migrations; CREATE TABLE __drizzle_migrations (legacy TEXT)');
  db.close();

  try {
    await seedDatabase(location.path);

    const seeded = await location.open();

    try {
      expect(seeded.orm.select().from(projects).all()).toHaveLength(5);
    } finally {
      seeded.close();
    }
  } finally {
    await location.cleanup();
  }
});

testStable('busy SQLite writers prevent replacement and retain the original content', async () => {
  const location = await createTestDatabase();
  const db = await location.open();

  db.orm
    .insert(projects)
    .values({
      name: 'Keep this subject',
      created_at: 1n,
      updated_at: 1n
    })
    .run();
  db.exec('BEGIN IMMEDIATE');

  try {
    await expect(seedDatabase(location.path)).rejects.toThrow();
  } finally {
    db.exec('ROLLBACK');
    db.close();
  }

  try {
    const retained = await location.open();

    try {
      expect(
        retained.orm
          .select()
          .from(projects)
          .all()
          .map((row) => row.name)
      ).toEqual(['Keep this subject']);
    } finally {
      retained.close();
    }

    expect(await Effect.runPromise(fs.readDirectory(location.dir))).toEqual([
      location.path.split('/').at(-1)
    ]);
  } finally {
    await location.cleanup();
  }
});

testStable(
  'a missing target cannot replay orphaned WAL pages over the seeded database',
  async () => {
    const location = await createTestDatabase();

    try {
      const crashed = Bun.spawnSync(
        [
          process.execPath,
          '-e',
          `
      import { Db } from '@study/db';
      import { projects } from '@study/db/schema';
      const db = await Db.open(process.argv[1]);
      db.orm.insert(projects).values({
        name: 'Old WAL subject', created_at: 1n, updated_at: 1n
      }).run();
      process.kill(process.pid, 'SIGKILL');
    `,
          location.path
        ],
        { cwd: Bun.fileURLToPath(new URL('..', import.meta.url)) }
      );

      expect(crashed.signalCode).toBe('SIGKILL');
      expect(Bun.file(location.path + '-wal').size).toBeGreaterThan(0);
      await Effect.runPromise(fs.remove(location.path));
      await seedDatabase(location.path);

      const db = await location.open();

      try {
        expect(db.orm.select().from(projects).all()).toHaveLength(5);
        expect(
          db.orm.get(sql`SELECT count(*) n FROM projects WHERE name = 'Old WAL subject'`)?.n
        ).toBe(0n);
        expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      } finally {
        db.close();
      }
    } finally {
      await location.cleanup();
    }
  }
);

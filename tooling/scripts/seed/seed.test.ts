import { BunFileSystem } from '@effect/platform-bun';
import { BunPath } from '@effect/platform-bun';
import { Db, sql } from '@study/db';
import { projects, source_blobs, sources, page_versions } from '@study/db';
import { acquireDatabaseOwnership } from '@study/server/runtime/ownership';
import { test } from '@study/testing';
import { Effect, FileSystem, Path } from 'effect';

import { seedDatabase } from './seed.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

test.stable(
  'replaces all old content with readable, linked pages and repeatable study data',
  async ({ databases }) => {
    const location = await databases();
    let db = await location.open();

    db.orm
      .insert(projects)
      .values({ name: 'Old private subject', created_at: 1n, updated_at: 1n })
      .run();
    db.close();

    try {
      await seedDatabase(location.path);
      db = await location.open();
      test.expect(db.orm.select().from(projects).all()).toHaveLength(5);
      test
        .expect(db.orm.all(sql`SELECT * FROM projects WHERE name = 'Old private subject'`))
        .toEqual([]);

      const imported = db.orm.select().from(sources).all();

      test.expect(imported).toHaveLength(15);
      test
        .expect(
          db.orm
            .select()
            .from(source_blobs)
            .all()
            .every((row) => row.bytes.length > 0)
        )
        .toBe(true);
      test
        .expect(
          db.orm
            .select()
            .from(page_versions)
            .all()
            .every((row) => row.status === 'published')
        )
        .toBe(true);
      test.expect(db.orm.get(sql`SELECT count(*) n FROM pages`)?.n).toBe(10n);
      test.expect(db.orm.get(sql`SELECT count(*) n FROM material_flashcard_entries`)?.n).toBe(20n);
      test.expect(db.orm.get(sql`SELECT count(*) n FROM material_quiz_questions`)?.n).toBe(15n);
      test.expect(db.orm.get(sql`SELECT count(*) n FROM messages`)?.n).toBe(100n);
      test
        .expect(
          db.orm
            .all(sql`SELECT project_id, count(*) n FROM project_notes GROUP BY project_id`)
            .map((row) => row.n)
        )
        .toEqual([10n, 10n, 10n, 10n, 10n]);
      test
        .expect(
          db.orm
            .all(sql`SELECT DISTINCT kind FROM material_quiz_questions`)
            .map((row) => row.kind)
            .sort()
        )
        .toEqual(['multiple_choice', 'open', 'single_choice']);
      test
        .expect(
          db.orm
            .all(sql`SELECT DISTINCT kind FROM blocks`)
            .map((row) => row.kind)
            .sort()
        )
        .toEqual(['code', 'heading', 'math', 'paragraph', 'table']);
      test.expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      test.expect(db.orm.get(sql`PRAGMA integrity_check`)?.integrity_check).toBe('ok');

      const names = imported.map((row) => row.name);

      db.close();
      await seedDatabase(location.path);
      db = await location.open();
      test
        .expect(
          db.orm
            .select()
            .from(sources)
            .all()
            .map((row) => row.name)
        )
        .toEqual(names);
      test.expect(db.orm.get(sql`SELECT count(*) n FROM projects`)?.n).toBe(5n);
    } finally {
      db.close();
    }
  }
);

test.stable('refuses an owned database without modifying it', async ({ databases }) => {
  const location = await databases();
  const db = await location.open();

  db.close();

  const before = new Uint8Array(await Bun.file(location.path).arrayBuffer());
  const owner = await acquireDatabaseOwnership(location.path);

  try {
    await test.expect(seedDatabase(location.path)).rejects.toMatchObject({ kind: 'transient' });
    test.expect(new Uint8Array(await Bun.file(location.path).arrayBuffer())).toEqual(before);
    test
      .expect(await Effect.runPromise(fs.readDirectory(location.dir)))
      .toEqual([location.path.split('/').at(-1)]);
  } finally {
    await owner.release();
  }
});

test.stable(
  'creates a missing parent directory and leaves no staging database',
  async ({ databases }) => {
    const location = await databases();
    const path = join(location.dir, 'nested', 'study.sqlite');

    await seedDatabase(path);
    test.expect(await Bun.file(path).exists()).toBe(true);
    test
      .expect(await Effect.runPromise(fs.readDirectory(join(location.dir, 'nested'))))
      .toEqual(['study.sqlite']);
    test.expect(await Db.validateSnapshot(path)).toBeTruthy();
  }
);

test.stable(
  'bun seed honors STUDY_DATABASE and help leaves its target untouched',
  async ({ resources }) => {
    const temporary = await test.temporaryDirectory();
    const path = join(temporary.path, 'study.sqlite');
    const env = { ...process.env, STUDY_DATABASE: path };
    const cwd = Bun.fileURLToPath(new URL('../../../', import.meta.url));

    const help = test.spawnTestProcessSync(['bun', 'seed', '--help'], { env, cwd });

    test.expect(help.exitCode, help.stderr.toString()).toBe(0);
    test.expect(help.stdout.toString()).toContain('STUDY_DATABASE');
    test.expect(await Bun.file(path).exists()).toBe(false);
    test
      .expect(test.spawnTestProcessSync(['bun', 'seed', '--unknown'], { env, cwd }).exitCode)
      .not.toBe(0);
    test.expect(await Bun.file(path).exists()).toBe(false);
    test.expect(test.spawnTestProcessSync(['bun', 'seed'], { env, cwd }).exitCode).toBe(0);

    const db = await resources.openDb(path);

    try {
      test.expect(db.orm.select().from(projects).all()).toHaveLength(5);
    } finally {
      db.close();
    }
  }
);

test.stable('reset does not migrate the database being discarded', async ({ databases }) => {
  const location = await databases();
  const db = await location.open();

  db.exec('DROP TABLE __drizzle_migrations; CREATE TABLE __drizzle_migrations (legacy TEXT)');
  db.close();

  await seedDatabase(location.path);

  const seeded = await location.open();

  try {
    test.expect(seeded.orm.select().from(projects).all()).toHaveLength(5);
  } finally {
    seeded.close();
  }
});

test.stable(
  'busy SQLite writers prevent replacement and retain the original content',
  async ({ databases }) => {
    const location = await databases();
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
      await test.expect(seedDatabase(location.path)).rejects.toThrow();
    } finally {
      db.exec('ROLLBACK');
      db.close();
    }

    const retained = await location.open();

    try {
      test
        .expect(
          retained.orm
            .select()
            .from(projects)
            .all()
            .map((row) => row.name)
        )
        .toEqual(['Keep this subject']);
    } finally {
      retained.close();
    }

    test
      .expect(await Effect.runPromise(fs.readDirectory(location.dir)))
      .toEqual([location.path.split('/').at(-1)]);
  }
);

test.stable(
  'a missing target cannot replay orphaned WAL pages over the seeded database',
  async ({ databases }) => {
    const location = await databases();

    const crashed = test.spawnTestProcessSync(
      [
        process.execPath,
        '-e',
        `
      import { Db } from '@study/db';
      import { projects } from '@study/db';
      const db = await Db.open(process.argv[1]);
      db.orm.insert(projects).values({
        name: 'Old WAL subject', created_at: 1n, updated_at: 1n
      }).run();
      process.kill(process.pid, 'SIGKILL');
    `,
        location.path
      ],
      { cwd: Bun.fileURLToPath(new URL('../..', import.meta.url)) }
    );

    test.expect(crashed.signalCode).toBe('SIGKILL');
    test.expect(Bun.file(location.path + '-wal').size).toBeGreaterThan(0);
    await Effect.runPromise(fs.remove(location.path));
    await seedDatabase(location.path);

    const db = await location.open();

    try {
      test.expect(db.orm.select().from(projects).all()).toHaveLength(5);
      test
        .expect(db.orm.get(sql`SELECT count(*) n FROM projects WHERE name = 'Old WAL subject'`)?.n)
        .toBe(0n);
      test.expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    } finally {
      db.close();
    }
  }
);

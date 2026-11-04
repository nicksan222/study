import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Db, sql } from '@study/db';
import { projects, source_blobs, sources, study_document_versions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { acquireDatabaseOwnership } from '@study/server/runtime/ownership';
import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { seedDatabase } from './seed.ts';

testStable(
  'replaces all old content with readable, linked documents and repeatable study data',
  async () => {
    const location = createTestDatabase();
    let db = location.open();

    db.orm
      .insert(projects)
      .values({ name: 'Old private subject', created_at: 1n, updated_at: 1n })
      .run();
    db.close();

    try {
      await seedDatabase(location.path);
      db = location.open();
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
          .from(study_document_versions)
          .all()
          .every((row) => row.status === 'published')
      ).toBe(true);
      expect(db.orm.get(sql`SELECT count(*) n FROM study_documents`)?.n).toBe(10n);
      expect(db.orm.get(sql`SELECT count(*) n FROM material_flashcard_entries`)?.n).toBe(20n);
      expect(db.orm.get(sql`SELECT count(*) n FROM material_quiz_questions`)?.n).toBe(15n);
      expect(db.orm.get(sql`SELECT count(*) n FROM messages`)?.n).toBe(100n);
      expect(
        db.orm
          .all(sql`SELECT project_id, count(*) n FROM project_sessions GROUP BY project_id`)
          .map((row) => row.n)
      ).toEqual([10n, 10n, 10n, 10n, 10n]);
      expect(db.orm.get(sql`SELECT count(*) n FROM material_diagram_versions`)?.n).toBe(5n);
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
      db = location.open();
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
      location.cleanup();
    }
  }
);

testStable('refuses an owned database without modifying it', async () => {
  const location = createTestDatabase();
  const db = location.open();

  db.close();

  const before = readFileSync(location.path);
  const owner = await acquireDatabaseOwnership(location.path);

  try {
    await expect(seedDatabase(location.path)).rejects.toMatchObject({ kind: 'transient' });
    expect(readFileSync(location.path)).toEqual(before);
    expect(readdirSync(location.dir)).toEqual([location.path.split('/').at(-1)]);
  } finally {
    await owner.release();
    location.cleanup();
  }
});

testStable('creates a missing parent directory and leaves no staging database', async () => {
  const location = createTestDatabase();
  const path = join(location.dir, 'nested', 'study.sqlite');

  try {
    await seedDatabase(path);
    expect(existsSync(path)).toBe(true);
    expect(readdirSync(join(location.dir, 'nested'))).toEqual(['study.sqlite']);
    expect(Db.validateSnapshot(path)).toBeTruthy();
  } finally {
    location.cleanup();
  }
});

testStable('bun seed honors STUDY_DATABASE and help leaves its target untouched', () => {
  const location = createTestDatabase();
  const env = { ...process.env, STUDY_DATABASE: location.path };

  try {
    const help = execFileSync('bun', ['seed', '--help'], { env, encoding: 'utf8' });

    expect(help).toContain('STUDY_DATABASE');
    expect(existsSync(location.path)).toBe(false);
    expect(() => execFileSync('bun', ['seed', '--unknown'], { env, stdio: 'pipe' })).toThrow();
    expect(existsSync(location.path)).toBe(false);
    execFileSync('bun', ['seed'], { env, encoding: 'utf8' });

    const db = location.open();

    try {
      expect(db.orm.select().from(projects).all()).toHaveLength(5);
    } finally {
      db.close();
    }
  } finally {
    location.cleanup();
  }
});

testStable('reset does not migrate the database being discarded', async () => {
  const location = createTestDatabase();
  const db = location.open();

  db.exec('DROP TABLE __drizzle_migrations; CREATE TABLE __drizzle_migrations (legacy TEXT)');
  db.close();

  try {
    await seedDatabase(location.path);

    const seeded = location.open();

    try {
      expect(seeded.orm.select().from(projects).all()).toHaveLength(5);
    } finally {
      seeded.close();
    }
  } finally {
    location.cleanup();
  }
});

testStable('busy SQLite writers prevent replacement and retain the original content', async () => {
  const location = createTestDatabase();
  const db = location.open();

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
    const retained = location.open();

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

    expect(readdirSync(location.dir)).toEqual([location.path.split('/').at(-1)]);
  } finally {
    location.cleanup();
  }
});

testStable(
  'a missing target cannot replay orphaned WAL pages over the seeded database',
  async () => {
    const location = createTestDatabase();

    try {
      const crashed = spawnSync(process.execPath, [
        '--input-type=module',
        '-e',
        `
      import { Db } from '@study/db';
      import { projects } from '@study/db/schema';
      const db = Db.open(process.argv[1]);
      db.orm.insert(projects).values({
        name: 'Old WAL subject', created_at: 1n, updated_at: 1n
      }).run();
      process.kill(process.pid, 'SIGKILL');
    `,
        location.path
      ]);

      expect(crashed.signal).toBe('SIGKILL');
      expect(statSync(location.path + '-wal').size).toBeGreaterThan(0);
      rmSync(location.path);
      await seedDatabase(location.path);

      const db = location.open();

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
      location.cleanup();
    }
  }
);

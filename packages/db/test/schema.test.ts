import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { projectIdSchema } from '@study/contracts/ids';
import { spawnTestProcess } from '@study/testing/process';
import { testStable } from '@study/testing/vitest';
import { sql, eq, getTableName } from 'drizzle-orm';
import { Effect, FileSystem, Path, Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/index.ts';
import * as schema from '../src/schema.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const { dirname, join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

function assertThrowsMatching(run: () => unknown, matches: (error: unknown) => boolean) {
  try {
    run();
  } catch (error) {
    assert.ok(matches(error), 'Thrown error did not match');

    return;
  }

  assert.fail('Expected function to throw');
}

async function fixture(run: (path: string) => Promise<void>) {
  const folder = await Effect.runPromise(fs.makeTempDirectory({ prefix: 'study-schema-' }));

  try {
    await run(join(folder, 'study.db'));
  } finally {
    await Effect.runPromise(fs.remove(folder, { recursive: true, force: true }));
  }
}

testStable('the Drizzle baseline initializes every modeled table and current code vocabulary', () =>
  fixture(async (path) => {
    const connection = await Db.open(path);
    const db = connection.orm;

    try {
      const tables = db
        .all(
          sql.raw(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name != '__drizzle_migrations' ORDER BY name"
          )
        )
        .map((row) => row.name);

      expect(tables).toStrictEqual(Object.values(schema).map(getTableName).sort());

      for (const [name, table] of Object.entries(schema))
        if (name.startsWith('codes_')) {
          const codes = db
            .all(sql.raw(`SELECT code FROM "${name}" ORDER BY code`))
            .map((row) => row.code);

          expect(codes).toStrictEqual('code' in table ? [...table.code.enumValues!].sort() : []);
        }

      expect(db.all(sql.raw('PRAGMA foreign_key_check'))).toStrictEqual([]);
    } finally {
      connection.close();
    }

    const reopened = await Db.open(path);

    reopened.close();
  })
);

testStable(
  'Drizzle reads and writes identities beyond Number precision without losing references',
  () =>
    fixture(async (path) => {
      const connection = await Db.open(path);
      const db = connection.orm;
      const id = Schema.decodeUnknownSync(projectIdSchema)(9007199254740993n);

      try {
        db.insert(schema.projects)
          .values({ id, name: 'Large identity', created_at: 1n, updated_at: 1n })
          .run();
        const next = db
          .insert(schema.projects)
          .values({ name: 'Next identity', created_at: 1n, updated_at: 1n })
          .returning()
          .get();

        assert.strictEqual(next.id, id + 1n);
        const note = db
          .insert(schema.notes)
          .values({
            title: 'Note',
            title_source: 'user',
            created_at: 1n,
            updated_at: 1n
          })
          .returning()
          .get();

        db.insert(schema.project_notes).values({ project_id: id, note_id: note.id }).run();
        assert.strictEqual(db.select().from(schema.project_notes).get()?.project_id, id);
        assertThrowsMatching(
          () =>
            db
              .insert(schema.project_notes)
              .values({
                project_id: Schema.decodeUnknownSync(projectIdSchema)(id + 100n),
                note_id: note.id
              })
              .run(),
          (error: unknown) =>
            error instanceof Error &&
            error.cause instanceof Error &&
            'errno' in error.cause &&
            error.cause.errno === 787
        );
        db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
        assert.strictEqual(db.select().from(schema.notes).get()?.id, note.id);
        db.insert(schema.projects)
          .values({
            id,
            name: 'Restored identity',
            created_at: 1n,
            updated_at: 1n
          })
          .run();
        assert.strictEqual(
          db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()?.id,
          id
        );
      } finally {
        connection.close();
      }
    })
);

testStable(
  'Drizzle generation is stable and leaves SQL-managed FTS outside schema diffs',
  async () => {
    const folder = await Effect.runPromise(
      fs.makeTempDirectory({ prefix: 'study-drizzle-generate-' })
    );

    try {
      const output = join(folder, 'drizzle');

      await Effect.runPromise(
        fs.copy(Bun.fileURLToPath(new URL('../drizzle', import.meta.url)), output)
      );
      const before = await Effect.runPromise(fs.readDirectory(output));
      const config = join(folder, 'drizzle.config.ts');

      await Bun.write(
        config,
        `export default ${JSON.stringify({ dialect: 'sqlite', schema: Bun.fileURLToPath(new URL('../src/schema.ts', import.meta.url)), out: output })};`
      );
      const child = spawnTestProcess(
        [
          process.execPath,
          join(
            dirname(
              Bun.resolveSync(
                'drizzle-kit/package.json',
                Bun.fileURLToPath(new URL('.', import.meta.url))
              )
            ),
            'bin.cjs'
          ),
          'generate',
          '--config',
          config
        ],
        { stdout: 'pipe', stderr: 'pipe' }
      );
      const [status, result, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text()
      ]);

      assert.strictEqual(status, 0, stderr);

      expect(result).toMatch(/No schema changes/);
      expect(await Effect.runPromise(fs.readDirectory(output))).toStrictEqual(before);
    } finally {
      await Effect.runPromise(fs.remove(folder, { recursive: true, force: true }));
    }
  }
);

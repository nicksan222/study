import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { projectIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { sql, eq, getTableName } from 'drizzle-orm';
import { Effect, FileSystem, Path, Schema } from 'effect';

import { Db } from '../src/index.ts';
import * as schema from '../src/schema.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const { dirname, join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

function assertThrowsMatching(run: () => unknown, matches: (error: unknown) => boolean) {
  try {
    run();
  } catch (error) {
    test.assert.ok(matches(error), 'Thrown error did not match');

    return;
  }

  test.assert.fail('Expected function to throw');
}

async function fixture(run: (path: string) => Promise<void>) {
  await using folder = await test.temporaryDirectory({ prefix: 'study-schema-' });

  await run(join(folder.path, 'study.db'));
}

test.stable(
  'the Drizzle baseline initializes every modeled table and current code vocabulary',
  () =>
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

        test.expect(tables).toStrictEqual(Object.values(schema).map(getTableName).sort());

        for (const [name, table] of Object.entries(schema))
          if (name.startsWith('codes_')) {
            const codes = db
              .all(sql.raw(`SELECT code FROM "${name}" ORDER BY code`))
              .map((row) => row.code);

            test
              .expect(codes)
              .toStrictEqual('code' in table ? [...table.code.enumValues!].sort() : []);
          }

        test.expect(db.all(sql.raw('PRAGMA foreign_key_check'))).toStrictEqual([]);
      } finally {
        connection.close();
      }

      const reopened = await Db.open(path);

      reopened.close();
    })
);

test.stable(
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

        test.assert.strictEqual(next.id, id + 1n);
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
        test.assert.strictEqual(db.select().from(schema.project_notes).get()?.project_id, id);
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
        test.assert.strictEqual(db.select().from(schema.notes).get()?.id, note.id);
        db.insert(schema.projects)
          .values({
            id,
            name: 'Restored identity',
            created_at: 1n,
            updated_at: 1n
          })
          .run();
        test.assert.strictEqual(
          db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()?.id,
          id
        );
      } finally {
        connection.close();
      }
    })
);

test.stable(
  'Drizzle generation is stable and leaves SQL-managed FTS outside schema diffs',
  async () => {
    await using folder = await test.temporaryDirectory({ prefix: 'study-drizzle-generate-' });

    const output = join(folder.path, 'drizzle');

    await Effect.runPromise(
      fs.copy(Bun.fileURLToPath(new URL('../drizzle', import.meta.url)), output)
    );
    const before = await Effect.runPromise(fs.readDirectory(output));
    const config = join(folder.path, 'drizzle.config.ts');

    await Bun.write(
      config,
      `export default ${JSON.stringify({ dialect: 'sqlite', schema: Bun.fileURLToPath(new URL('../src/schema.ts', import.meta.url)), out: output })};`
    );
    const child = test.spawnTestProcess(
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

    test.assert.strictEqual(status, 0, stderr);

    test.expect(result).toMatch(/No schema changes/);
    test.expect(await Effect.runPromise(fs.readDirectory(output))).toStrictEqual(before);
  }
);

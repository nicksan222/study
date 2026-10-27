import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sql, eq, getTableName } from 'drizzle-orm';

import { Db } from '../src/index.ts';
import * as schema from '../src/schema.ts';

function fixture(run: (path: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), 'study-schema-'));

  try {
    run(join(folder, 'study.db'));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test('the Drizzle baseline initializes every modeled table and current code vocabulary', () =>
  fixture((path) => {
    const connection = Db.open(path);
    const db = connection.orm;

    try {
      const tables = db
        .all(
          sql.raw(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name != '__drizzle_migrations' ORDER BY name"
          )
        )
        .map((row) => row.name);

      assert.deepEqual(tables, Object.values(schema).map(getTableName).sort());

      for (const [name, table] of Object.entries(schema))
        if (name.startsWith('codes_')) {
          const codes = db
            .all(sql.raw(`SELECT code FROM "${name}" ORDER BY code`))
            .map((row) => row.code);

          assert.deepEqual(codes, 'code' in table ? [...table.code.enumValues!].sort() : []);
        }

      assert.deepEqual(db.all(sql.raw('PRAGMA foreign_key_check')), []);
      assert.equal(db.get(sql.raw('SELECT count(*) AS n FROM __drizzle_migrations'))?.n, 1n);
      assert.deepEqual(db.select().from(schema.codes_requirement).all(), [
        { code: 'language_models' }
      ]);
      assert.equal(
        db.get(
          sql.raw("SELECT name FROM sqlite_schema WHERE name IN ('schema_meta','embeddings')")
        ),
        undefined
      );
    } finally {
      connection.close();
    }

    const reopened = Db.open(path);

    reopened.close();
  }));

test('Drizzle reads and writes identities beyond Number precision without losing references', () =>
  fixture((path) => {
    const connection = Db.open(path);
    const db = connection.orm;
    const id = 9007199254740993n;

    try {
      db.insert(schema.projects)
        .values({ id, name: 'Large identity', created_at: 1n, updated_at: 1n })
        .run();
      const next = db
        .insert(schema.projects)
        .values({ name: 'Next identity', created_at: 1n, updated_at: 1n })
        .returning()
        .get();

      assert.equal(next.id, id + 1n);
      const session = db
        .insert(schema.sessions)
        .values({
          project_id: id,
          title: 'Session',
          title_source: 'user',
          created_at: 1n,
          updated_at: 1n
        })
        .returning()
        .get();

      assert.equal(session.project_id, id);
      assert.throws(
        () =>
          db
            .insert(schema.sessions)
            .values({
              project_id: id + 100n,
              title: 'Missing project',
              title_source: 'user',
              created_at: 1n,
              updated_at: 1n
            })
            .run(),
        (error: unknown) =>
          error instanceof Error &&
          error.cause instanceof Error &&
          'errcode' in error.cause &&
          error.cause.errcode === 787
      );
      db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
      assert.equal(db.select().from(schema.sessions).get(), undefined);
      db.insert(schema.projects)
        .values({
          id,
          name: 'Restored identity',
          created_at: 1n,
          updated_at: 1n
        })
        .run();
      assert.equal(
        db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()?.id,
        id
      );
    } finally {
      connection.close();
    }
  }));

test('Drizzle generation is stable and leaves SQL-managed FTS outside schema diffs', () => {
  const folder = mkdtempSync(join(tmpdir(), 'study-drizzle-generate-'));

  try {
    const output = join(folder, 'drizzle');

    cpSync(new URL('../drizzle', import.meta.url), output, { recursive: true });
    const before = readdirSync(output);
    const config = join(folder, 'drizzle.config.ts');

    writeFileSync(
      config,
      `export default ${JSON.stringify({ dialect: 'sqlite', schema: fileURLToPath(new URL('../src/schema.ts', import.meta.url)), out: output })};`
    );
    const result = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../../node_modules/drizzle-kit/bin.cjs', import.meta.url)),
        'generate',
        '--config',
        config
      ],
      { encoding: 'utf8' }
    );

    assert.match(result, /No schema changes/);
    assert.deepEqual(readdirSync(output), before);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

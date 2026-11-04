import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectIdSchema } from '@study/contracts/ids';
import { testMigration, testStable } from '@study/testing/vitest';
import { sql, eq, getTableName } from 'drizzle-orm';
import { Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/index.ts';
import * as schema from '../src/schema.ts';

function assertThrowsMatching(run: () => unknown, matches: (error: unknown) => boolean) {
  try {
    run();
  } catch (error) {
    assert.ok(matches(error), 'Thrown error did not match');

    return;
  }

  assert.fail('Expected function to throw');
}

function fixture(run: (path: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), 'study-schema-'));

  try {
    run(join(folder, 'study.db'));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

testStable('the Drizzle baseline initializes every modeled table and current code vocabulary', () =>
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

      expect(tables).toStrictEqual(Object.values(schema).map(getTableName).sort());

      for (const [name, table] of Object.entries(schema))
        if (name.startsWith('codes_')) {
          const codes = db
            .all(sql.raw(`SELECT code FROM "${name}" ORDER BY code`))
            .map((row) => row.code);

          expect(codes).toStrictEqual('code' in table ? [...table.code.enumValues!].sort() : []);
        }

      expect(db.all(sql.raw('PRAGMA foreign_key_check'))).toStrictEqual([]);
      assert.ok(
        (db.get<{ n: bigint }>(sql.raw('SELECT count(*) AS n FROM __drizzle_migrations'))?.n ??
          0n) >= 9n
      );
      assert.strictEqual(
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
  })
);

testStable(
  'Drizzle reads and writes identities beyond Number precision without losing references',
  () =>
    fixture((path) => {
      const connection = Db.open(path);
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
        const session = db
          .insert(schema.sessions)
          .values({
            title: 'Session',
            title_source: 'user',
            created_at: 1n,
            updated_at: 1n
          })
          .returning()
          .get();

        db.insert(schema.project_sessions).values({ project_id: id, session_id: session.id }).run();
        assert.strictEqual(db.select().from(schema.project_sessions).get()?.project_id, id);
        assertThrowsMatching(
          () =>
            db
              .insert(schema.project_sessions)
              .values({
                project_id: Schema.decodeUnknownSync(projectIdSchema)(id + 100n),
                session_id: session.id
              })
              .run(),
          (error: unknown) =>
            error instanceof Error &&
            error.cause instanceof Error &&
            'errcode' in error.cause &&
            error.cause.errcode === 787
        );
        db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
        assert.strictEqual(db.select().from(schema.sessions).get()?.id, session.id);
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

testStable('Drizzle generation is stable and leaves SQL-managed FTS outside schema diffs', () => {
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

    expect(result).toMatch(/No schema changes/);
    expect(readdirSync(output)).toStrictEqual(before);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

testStable('retired projection tables and message job ownership are absent', () =>
  fixture((path) => {
    const connection = Db.open(path);

    try {
      const db = connection.orm;

      assert.strictEqual(
        db.get(sql.raw("SELECT name FROM sqlite_schema WHERE type='table' AND name='jobs'")),
        undefined
      );
      assert.strictEqual(
        db
          .all(sql.raw('PRAGMA table_info(message_versions)'))
          .some((column) => column.name === 'owner_job_id'),
        false
      );
    } finally {
      connection.close();
    }
  })
);

testMigration({ migration: 'ask_migration', retention: 'permanent' })(
  'Ask migration retains exact retirement and reply publication guards after table rebuilds',
  () =>
    fixture((path) => {
      const connection = Db.open(path);

      try {
        const names = new Set(
          connection.orm
            .all(sql`SELECT name FROM sqlite_schema WHERE type='trigger'`)
            .map((row) => row.name)
        );

        for (const name of [
          'message_fts_ai',
          'message_fts_ad',
          'message_fts_finish',
          'conversation_recording_posts_validate_insert',
          'session_retired_intents_owner',
          'session_retired_intents_update',
          'session_retired_intents_delete',
          'session_retired_intent_recapture',
          'conversation_reply_sources_capture',
          'conversation_reply_sources_immutable',
          'conversation_reply_sources_retained'
        ])
          assert.ok(names.has(name), name);

        assert.throws(() =>
          connection.orm.run(sql`INSERT INTO session_retired_intents
        (session_id,intent_key,request_id,reason) VALUES (1,'forged','missing','input_retired')`)
        );
        expect(connection.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        connection.close();
      }
    })
);

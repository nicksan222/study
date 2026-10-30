import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { versionIdSchema } from '@study/contracts/ids';
import { eq, sql } from 'drizzle-orm';
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { Schema } from 'effect';

import { Db } from '../src/index.ts';
import * as schema from '../src/schema.ts';

function newDb(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'study-constraints-'));
  const connection = Db.open(join(folder, 'study.db'));

  t.after(() => {
    connection.close();
    rmSync(folder, { recursive: true, force: true });
  });

  return seed(connection.orm);
}

function seed(db: NodeSQLiteDatabase) {
  const project = db
    .insert(schema.projects)
    .values({ name: 'P', created_at: 1n, updated_at: 1n })
    .returning()
    .get();
  const source = db
    .insert(schema.sources)
    .values({
      origin: 'note',
      kind: 'note',
      mime: 'text/plain',
      name: 'N',
      size_bytes: 1n,
      sha256: Buffer.alloc(32),
      created_at: 1n
    })
    .returning()
    .get();
  const document = db
    .insert(schema.documents)
    .values({ source_id: source.id, extractor_version: 0n, meta: '{}', created_at: 1n })
    .returning()
    .get();
  const session = db
    .insert(schema.sessions)
    .values({
      project_id: project.id,
      title: 'S',
      title_source: 'user',
      created_at: 1n,
      updated_at: 1n
    })
    .returning()
    .get();
  const message = db
    .insert(schema.messages)
    .values({ session_id: session.id, role: 'assistant', created_at: 1n })
    .returning()
    .get();
  const version = db
    .insert(schema.message_versions)
    .values({
      message_id: message.id,
      number: 1n,
      origin: 'answer',
      status: 'complete',
      text: 'photosynthesis',
      created_at: 1n
    })
    .returning()
    .get();

  return { db, source, document, session, message, version };
}

function checkViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.cause instanceof Error &&
    'errcode' in error.cause &&
    error.cause.errcode === 275
  );
}

test('message instructions are nullable but otherwise nonblank and bounded', (t) => {
  const { db, version } = newDb(t);

  assert.equal(version.instruction, null);

  for (const instruction of ['', '   ', '\t\n\r', '\u00a0\u2003\ufeff', 'x'.repeat(100001)])
    assert.throws(
      () =>
        db
          .update(schema.message_versions)
          .set({ origin: 'instruction', instruction })
          .where(eq(schema.message_versions.id, version.id))
          .run(),
      checkViolation
    );

  db.update(schema.message_versions)
    .set({ origin: 'instruction', instruction: 'x'.repeat(100000) })
    .where(eq(schema.message_versions.id, version.id))
    .run();
  assert.equal(db.select().from(schema.message_versions).get()?.instruction?.length, 100000);
});

test('message citations enforce unsigned 32 bit positive markers', (t) => {
  const { db, version } = newDb(t);
  const citation = { source_name: 'N', anchor: '{}', quote: 'Quote' };

  for (const marker of [0n, -1n, 4294967296n]) {
    assert.throws(
      () =>
        db
          .insert(schema.citations)
          .values({ ...citation, version_id: version.id, marker })
          .run(),
      checkViolation
    );
  }

  for (const marker of [1n, 4294967295n]) {
    db.insert(schema.citations)
      .values({ ...citation, version_id: version.id, marker })
      .run();
  }

  assert.equal(db.select().from(schema.citations).all().length, 2);
});

test('fresh baseline preserves populated references and message search triggers across reopen', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'study-constraint-migration-'));
  const path = join(folder, 'study.db');

  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const first = Db.open(path);
  const original = first.orm;

  const { message, version } = seed(original);

  original
    .update(schema.messages)
    .set({ active_version_id: version.id })
    .where(eq(schema.messages.id, message.id))
    .run();
  original
    .insert(schema.citations)
    .values({ version_id: version.id, marker: 1n, source_name: 'N', anchor: '{}', quote: 'Q' })
    .run();
  first.close();

  const connection = Db.open(path);

  t.after(() => connection.close());
  const db = connection.orm;

  assert.equal(db.select().from(schema.messages).get()?.active_version_id, version.id);
  assert.equal(db.select().from(schema.citations).all().length, 1);
  assert.deepEqual(db.all(sql`PRAGMA foreign_key_check`), []);
  assert.equal(
    db.get(sql`SELECT rowid FROM message_fts WHERE message_fts MATCH 'photosynthesis'`)?.rowid,
    version.id
  );
  const next = db
    .insert(schema.message_versions)
    .values({
      message_id: message.id,
      number: 2n,
      origin: 'answer',
      status: 'complete',
      text: 'mitochondria',
      created_at: 1n
    })
    .returning()
    .get();

  assert.equal(
    db.get(sql`SELECT rowid FROM message_fts WHERE message_fts MATCH 'mitochondria'`)?.rowid,
    next.id
  );
  db.delete(schema.message_versions).where(eq(schema.message_versions.id, next.id)).run();
  assert.equal(
    db.get(sql`SELECT rowid FROM message_fts WHERE message_fts MATCH 'mitochondria'`),
    undefined
  );
  const pending = db
    .insert(schema.message_versions)
    .values({
      message_id: message.id,
      number: 3n,
      origin: 'answer',
      status: 'pending',
      created_at: 1n
    })
    .returning()
    .get();

  db.update(schema.message_versions)
    .set({ status: 'complete', text: 'chlorophyll' })
    .where(eq(schema.message_versions.id, pending.id))
    .run();
  assert.equal(
    db.get(sql`SELECT rowid FROM message_fts WHERE message_fts MATCH 'chlorophyll'`)?.rowid,
    pending.id
  );
});

for (const table of ['message_versions'] as const)
  for (const keepLowerRow of [false, true])
    test(`fresh baseline preserves deleted ${table} identities across reopen with ${keepLowerRow ? 'surviving rows' : 'an empty table'}`, (t) => {
      const folder = mkdtempSync(join(tmpdir(), 'study-migration-sequences-'));
      const path = join(folder, 'study.db');

      t.after(() => rmSync(folder, { recursive: true, force: true }));
      const first = Db.open(path);
      const original = first.orm;

      const { message } = seed(original);
      const target = schema.message_versions;

      original.delete(schema.message_versions).run();
      const highest = 9007199254740993n;
      const insert = (db: NodeSQLiteDatabase, ordinal: bigint, id?: bigint) => {
        return db
          .insert(schema.message_versions)
          .values({
            id: id === undefined ? undefined : Schema.decodeUnknownSync(versionIdSchema)(id),
            message_id: message.id,
            number: ordinal + 1n,
            origin: 'answer',
            status: 'complete',
            text: 'Answer',
            created_at: 1n
          })
          .returning()
          .get().id;
      };
      const lower = insert(original, 0n);

      assert.equal(insert(original, 1n, highest), highest);
      original
        .delete(target)
        .where(sql`${target.id} = ${highest}`)
        .run();

      if (!keepLowerRow)
        original
          .delete(target)
          .where(sql`${target.id} = ${lower}`)
          .run();

      first.close();
      const connection = Db.open(path);

      t.after(() => connection.close());
      assert.equal(
        connection.orm.get(sql`SELECT seq FROM sqlite_sequence WHERE name = ${table}`)?.seq,
        highest
      );
      assert.equal(insert(connection.orm, 2n), highest + 1n);
      assert.deepEqual(connection.orm.all(sql`PRAGMA foreign_key_check`), []);
    });

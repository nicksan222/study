import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { eq, sql } from 'drizzle-orm';
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

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
  const artifact = db
    .insert(schema.artifacts)
    .values({
      project_id: project.id,
      kind: 'flashcards',
      title: 'Cards',
      status: 'pending',
      created_at: 1n,
      updated_at: 1n
    })
    .returning()
    .get();
  const practice = db
    .insert(schema.practices)
    .values({ project_id: project.id, created_at: 1n, updated_at: 1n })
    .returning()
    .get();
  const question = db
    .insert(schema.practice_questions)
    .values({
      practice_id: practice.id,
      ordinal: 0n,
      kind: 'open',
      status: 'pending',
      created_at: 1n
    })
    .returning()
    .get();

  return { db, source, document, session, message, version, artifact, question };
}

function checkViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.cause instanceof Error &&
    'errcode' in error.cause &&
    error.cause.errcode === 275
  );
}

test('jobs accept every compatible kind and reject incompatible targets on insert and update', (t) => {
  const { db, source, document, session, message, artifact, question } = newDb(t);
  const targets = {
    source_id: source.id,
    document_id: document.id,
    session_id: session.id,
    message_id: message.id,
    artifact_id: artifact.id,
    question_id: question.id
  };

  for (const [kind, target] of [
    ['fetch', 'source_id'],
    ['extract', 'source_id'],
    ['index', 'document_id'],
    ['title', 'session_id'],
    ['reply', 'message_id'],
    ['rewrite', 'message_id'],
    ['artifact', 'artifact_id'],
    ['question', 'question_id'],
    ['grade', 'question_id']
  ] as const) {
    const input = {
      kind,
      dedupe_key: kind,
      status: 'queued' as const,
      created_at: 1n,
      updated_at: 1n
    };
    const job = db
      .insert(schema.jobs)
      .values({ ...input, [target]: targets[target] })
      .returning()
      .get();

    assert.equal(job.kind, kind);
    assert.throws(
      () =>
        db
          .update(schema.jobs)
          .set({ kind: kind === 'title' ? 'extract' : 'title' })
          .where(eq(schema.jobs.id, job.id))
          .run(),
      checkViolation
    );

    for (const [column, id] of Object.entries(targets)) {
      if (column === target) continue;

      assert.throws(
        () =>
          db
            .insert(schema.jobs)
            .values({ ...input, dedupe_key: `${kind}:${column}`, [column]: id })
            .run(),
        checkViolation
      );
    }
  }
});

test('job dependencies reject self references while accepting other jobs', (t) => {
  const { db, source } = newDb(t);
  const first = db
    .insert(schema.jobs)
    .values({
      kind: 'fetch',
      source_id: source.id,
      dedupe_key: 'fetch',
      status: 'queued',
      created_at: 1n,
      updated_at: 1n
    })
    .returning()
    .get();
  const second = db
    .insert(schema.jobs)
    .values({
      kind: 'extract',
      source_id: source.id,
      dedupe_key: 'extract',
      status: 'queued',
      created_at: 1n,
      updated_at: 1n
    })
    .returning()
    .get();

  assert.throws(
    () => db.insert(schema.job_deps).values({ job_id: first.id, depends_on: first.id }).run(),
    checkViolation
  );
  db.insert(schema.job_deps).values({ job_id: second.id, depends_on: first.id }).run();
  assert.deepEqual(db.select().from(schema.job_deps).all(), [
    { job_id: second.id, depends_on: first.id }
  ]);
});

test('cards enforce FSRS states and nonnegative scheduling counters', (t) => {
  const { db, artifact } = newDb(t);
  const card = db
    .insert(schema.cards)
    .values({ artifact_id: artifact.id, ordinal: 0n, front: 'Front', back: 'Back', due: 1n })
    .returning()
    .get();

  for (const state of [0n, 1n, 2n, 3n]) {
    db.update(schema.cards)
      .set({ state, elapsed_days: 1n, scheduled_days: 2n, learning_steps: 3n })
      .where(eq(schema.cards.id, card.id))
      .run();
    assert.equal(db.select().from(schema.cards).get()?.state, state);
  }

  for (const values of [
    { state: -1n },
    { state: 4n },
    { elapsed_days: -1n },
    { scheduled_days: -1n },
    { learning_steps: -1n }
  ])
    assert.throws(
      () => db.update(schema.cards).set(values).where(eq(schema.cards.id, card.id)).run(),
      checkViolation
    );
});

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

test('all citation tables enforce unsigned 32 bit positive markers', (t) => {
  const { db, version, artifact, question } = newDb(t);
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
    assert.throws(
      () =>
        db
          .insert(schema.artifact_citations)
          .values({ ...citation, artifact_id: artifact.id, marker })
          .run(),
      checkViolation
    );
    assert.throws(
      () =>
        db
          .insert(schema.question_citations)
          .values({ ...citation, question_id: question.id, marker })
          .run(),
      checkViolation
    );
  }

  for (const marker of [1n, 4294967295n]) {
    db.insert(schema.citations)
      .values({ ...citation, version_id: version.id, marker })
      .run();
    db.insert(schema.artifact_citations)
      .values({ ...citation, artifact_id: artifact.id, marker })
      .run();
    db.insert(schema.question_citations)
      .values({ ...citation, question_id: question.id, marker })
      .run();
  }

  assert.equal(db.select().from(schema.citations).all().length, 2);
  assert.equal(db.select().from(schema.artifact_citations).all().length, 2);
  assert.equal(db.select().from(schema.question_citations).all().length, 2);
});

test('fresh baseline preserves populated references and message search triggers across reopen', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'study-constraint-migration-'));
  const path = join(folder, 'study.db');

  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const first = Db.open(path);
  const original = first.orm;

  const { source, message, version, artifact } = seed(original);

  original
    .update(schema.messages)
    .set({ active_version_id: version.id })
    .where(eq(schema.messages.id, message.id))
    .run();
  original
    .insert(schema.citations)
    .values({ version_id: version.id, marker: 1n, source_name: 'N', anchor: '{}', quote: 'Q' })
    .run();
  const card = original
    .insert(schema.cards)
    .values({ artifact_id: artifact.id, ordinal: 0n, front: 'F', back: 'B', due: 1n })
    .returning()
    .get();

  original
    .insert(schema.reviews)
    .values({
      card_id: card.id,
      rating: 'good',
      reviewed_at: 1n,
      stability: 1,
      difficulty: 1,
      elapsed_days: 0
    })
    .run();
  const fetch = original
    .insert(schema.jobs)
    .values({
      kind: 'fetch',
      source_id: source.id,
      dedupe_key: 'fetch',
      status: 'queued',
      created_at: 1n,
      updated_at: 1n
    })
    .returning()
    .get();
  const extract = original
    .insert(schema.jobs)
    .values({
      kind: 'extract',
      source_id: source.id,
      dedupe_key: 'extract',
      status: 'queued',
      created_at: 1n,
      updated_at: 1n
    })
    .returning()
    .get();

  original.insert(schema.job_deps).values({ job_id: extract.id, depends_on: fetch.id }).run();
  original
    .update(schema.message_versions)
    .set({ owner_job_id: fetch.id, owner_attempt: 1n })
    .where(eq(schema.message_versions.id, version.id))
    .run();
  first.close();

  const connection = Db.open(path);

  t.after(() => connection.close());
  const db = connection.orm;

  assert.equal(db.select().from(schema.messages).get()?.active_version_id, version.id);
  assert.equal(db.select().from(schema.message_versions).get()?.owner_job_id, fetch.id);
  assert.equal(db.select().from(schema.citations).all().length, 1);
  assert.equal(db.select().from(schema.reviews).all().length, 1);
  assert.deepEqual(db.select().from(schema.job_deps).all(), [
    { job_id: extract.id, depends_on: fetch.id }
  ]);
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

for (const table of ['jobs', 'cards', 'message_versions'] as const)
  for (const keepLowerRow of [false, true])
    test(`fresh baseline preserves deleted ${table} identities across reopen with ${keepLowerRow ? 'surviving rows' : 'an empty table'}`, (t) => {
      const folder = mkdtempSync(join(tmpdir(), 'study-migration-sequences-'));
      const path = join(folder, 'study.db');

      t.after(() => rmSync(folder, { recursive: true, force: true }));
      const first = Db.open(path);
      const original = first.orm;

      const { source, artifact, message } = seed(original);
      const target = {
        jobs: schema.jobs,
        cards: schema.cards,
        message_versions: schema.message_versions
      }[table];

      original.delete(schema.message_versions).run();
      const highest = 9007199254740993n;
      const insert = (db: NodeSQLiteDatabase, ordinal: bigint, id?: bigint) => {
        if (table === 'jobs')
          return db
            .insert(schema.jobs)
            .values({
              id,
              kind: 'fetch',
              source_id: source.id,
              dedupe_key: String(ordinal),
              status: 'queued',
              created_at: 1n,
              updated_at: 1n
            })
            .returning()
            .get().id;

        if (table === 'cards')
          return db
            .insert(schema.cards)
            .values({ id, artifact_id: artifact.id, ordinal, front: 'F', back: 'B', due: 1n })
            .returning()
            .get().id;

        return db
          .insert(schema.message_versions)
          .values({
            id,
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
      original.delete(target).where(eq(target.id, highest)).run();

      if (!keepLowerRow) original.delete(target).where(eq(target.id, lower)).run();

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

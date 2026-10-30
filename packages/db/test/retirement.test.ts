/* eslint-disable study/database-ownership -- Upgrade fixture uses the official migrator for the preceding schema. */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

import { Db } from '../src/index.ts';

test('retirement upgrades populated canonical state, references, sequences and search', () => {
  const folder = mkdtempSync(join(tmpdir(), 'study-retirement-'));
  const path = join(folder, 'study.db');
  const migrations = join(folder, 'migrations');

  try {
    cpSync(fileURLToPath(new URL('../drizzle', import.meta.url)), migrations, { recursive: true });

    for (const entry of readdirSync(migrations))
      if (entry >= '20261029213743')
        rmSync(join(migrations, entry), { recursive: true, force: true });

    const old = new DatabaseSync(path, { readBigInts: true });

    old.exec('PRAGMA foreign_keys=OFF');
    migrate(drizzle({ client: old }), { migrationsFolder: migrations });
    old.exec(`PRAGMA foreign_keys=ON;
      INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1);
      INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(1,1,'note','note','text/plain','Source',1,zeroblob(32),1);
      INSERT INTO documents(id,source_id,extractor_version,meta,created_at) VALUES(1,1,0,'{}',1);
      INSERT INTO sessions(id,project_id,title,title_source,created_at,updated_at) VALUES(1,1,'Session','user',1,1);
      INSERT INTO messages(id,session_id,role,created_at) VALUES(1,1,'assistant',1);
      INSERT INTO artifacts(id,project_id,kind,title,status,created_at,updated_at) VALUES(1,1,'flashcards','Retired artifact','pending',1,1);
      INSERT INTO practices(id,project_id,created_at,updated_at) VALUES(1,1,1,1);
      INSERT INTO practice_questions(id,practice_id,ordinal,kind,status,created_at) VALUES(1,1,0,'open','pending',1);
      INSERT INTO cards(id,artifact_id,ordinal,front,back,due,question_id) VALUES(1,1,0,'Front','Back',1,1);
      INSERT INTO reviews(card_id,rating,reviewed_at,stability,difficulty,elapsed_days) VALUES(1,'good',1,1,1,0);
      INSERT INTO jobs(id,kind,source_id,dedupe_key,status,created_at,updated_at) VALUES(1,'fetch',1,'fetch','queued',1,1),(2,'extract',1,'extract','queued',1,1);
      INSERT INTO job_deps(job_id,depends_on) VALUES(2,1);
      INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at,owner_job_id,owner_attempt) VALUES(1,1,1,'answer','complete','photosynthesis',1,1,1);
      UPDATE messages SET active_version_id=1 WHERE id=1;
      INSERT INTO citations(version_id,marker,source_id,source_name,anchor,quote) VALUES(1,1,1,'Source','{}','Quote');
      INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(9007199254740993,1,2,'answer','complete','deleted',1);
      DELETE FROM message_versions WHERE id=9007199254740993;
      INSERT INTO materials(id,project_id,kind,title,created_at,updated_at) VALUES(1,1,'flashcards','Cards',1,1);
      INSERT INTO material_versions(id,material_id,project_id,kind,number,created_at) VALUES(1,1,1,'flashcards',1,1);
      INSERT INTO material_flashcard_versions(version_id,material_id) VALUES(1,1);
      INSERT INTO material_card_identities(id,material_id) VALUES(1,1);
      INSERT INTO material_flashcard_entries(version_id,material_id,card_id,position,front,back) VALUES(1,1,1,0,'Front','Back');
      INSERT INTO material_card_schedules(card_id,due,state,stability,difficulty,reps,lapses) VALUES(1,99,'review',2,5,1,0);
      UPDATE material_versions SET status='published',published_at=2 WHERE id=1;
      INSERT INTO material_card_reviews(card_id,version_id,reviewed_at,rating,elapsed_days) VALUES(1,1,3,'good',1);
      INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,created_at,updated_at) VALUES('exec','test',1,'{}','running',1,1);
      INSERT INTO workflow_job_bindings(execution_id,activity_name,activity_attempt,job_id,owner_token,snapshot) VALUES('exec','fetch',0,1,'owner','{}');
    `);
    const triggerSql = old
      .prepare(
        "SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND (tbl_name='message_versions' OR name='conversation_recording_posts_validate_insert') ORDER BY name"
      )
      .all()
      .map((row) => ({ ...row }));

    old.close();
    const connection = Db.open(path);

    try {
      const db = connection.orm;

      assert.deepEqual(db.all(sql`PRAGMA foreign_key_check`), []);
      assert.deepEqual(
        db.all(
          sql`SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND (tbl_name='message_versions' OR name='conversation_recording_posts_validate_insert') ORDER BY name`
        ),
        triggerSql
      );

      for (const table of [
        'jobs',
        'job_deps',
        'workflow_job_bindings',
        'artifacts',
        'cards',
        'reviews',
        'practices',
        'practice_questions',
        'artifact_sources',
        'artifact_citations',
        'artifact_note_snapshots',
        'question_citations'
      ])
        assert.equal(
          db.get(sql`SELECT name FROM sqlite_schema WHERE type='table' AND name=${table}`),
          undefined
        );

      assert.equal(
        db
          .all(sql`PRAGMA table_info(message_versions)`)
          .some((c) => c.name === 'owner_job_id' || c.name === 'owner_attempt'),
        false
      );
      assert.equal(
        db.get(sql`SELECT active_version_id FROM messages WHERE id=1`)?.active_version_id,
        1n
      );
      assert.equal(db.get(sql`SELECT source_id FROM citations WHERE version_id=1`)?.source_id, 1n);
      assert.equal(db.get(sql`SELECT source_id FROM documents WHERE id=1`)?.source_id, 1n);
      assert.equal(db.get(sql`SELECT due FROM material_card_schedules WHERE card_id=1`)?.due, 99n);
      assert.equal(
        db.get(sql`SELECT rating FROM material_card_reviews WHERE card_id=1`)?.rating,
        'good'
      );
      assert.equal(
        db.get(sql`SELECT status FROM workflow_executions WHERE execution_id='exec'`)?.status,
        'running'
      );
      assert.equal(
        db.get(sql`SELECT rowid FROM message_fts WHERE message_fts MATCH 'photosynthesis'`)?.rowid,
        1n
      );
      assert.equal(
        db.get(sql`SELECT rowid FROM catalog_fts WHERE catalog_fts MATCH 'Retired'`),
        undefined
      );
      connection.exec(
        "INSERT INTO message_versions(message_id,number,origin,status,text,created_at) VALUES(1,3,'answer','complete','mitochondria',1)"
      );
      assert.equal(
        db.get(sql`SELECT rowid FROM message_fts WHERE message_fts MATCH 'mitochondria'`)?.rowid,
        9007199254740994n
      );
      connection.exec(
        "INSERT INTO message_versions(message_id,number,origin,status,created_at) VALUES(1,4,'answer','pending',1)"
      );
      connection.exec(
        "UPDATE message_versions SET status='complete',text='chlorophyll' WHERE number=4"
      );
      assert.ok(db.get(sql`SELECT rowid FROM message_fts WHERE message_fts MATCH 'chlorophyll'`));
      connection.exec('DELETE FROM message_versions WHERE number=4');
      assert.equal(
        db.get(sql`SELECT rowid FROM message_fts WHERE message_fts MATCH 'chlorophyll'`),
        undefined
      );
      connection.exec('DELETE FROM projects WHERE id=1');
      assert.equal(db.get(sql`SELECT id FROM materials WHERE id=1`), undefined);
      assert.equal(
        db.get(sql`SELECT card_id FROM material_card_schedules WHERE card_id=1`),
        undefined
      );
      assert.deepEqual(db.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      connection.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

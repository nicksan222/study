import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testMigration } from '@study/testing/node';
import { sql } from 'drizzle-orm';

import { Db } from '../src/index.ts';

/** Live watch applied this exact migration name/hash before the next schema refinement. */
const applied = '20261103210031_glamorous_network';
const appliedHash = '8cf7fd38c8a2cbb7a8730759535b666a4b7a44520bd3f27912f66f7de4d4c07a';

testMigration({ migration: 'document_domains_cutover', retention: 'permanent' })(
  'official migrator upgrades the applied intermediate without recreating tables or losing exact message pins',
  async () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-intermediate-'));
    const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
    const previous = join(folder, 'migrations');
    mkdirSync(previous);
    let db: Db | undefined;
    try {
      assert.equal(
        createHash('sha256')
          .update(readFileSync(join(migrations, applied, 'migration.sql')))
          .digest('hex'),
        appliedHash
      );
      for (const name of readdirSync(migrations))
        if (name <= applied && !name.endsWith('_prepare-authored-assets'))
          cpSync(join(migrations, name), join(previous, name), { recursive: true });
      const path = join(folder, 'study.db');
      db = Db.open(path, previous);
      db.exec(`INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Session','user',1,1);
   INSERT INTO messages(id,session_id,role,created_at) VALUES(1,1,'user',1);
   INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(1,1,1,'typed','complete','Input',1);
   INSERT INTO study_documents(id,title,created_at,updated_at) VALUES(1,'Retained intermediate',1,1);
   INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(1,0,'{}',1);
   INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(1,0,'paragraph','intermediate','{"type":"paragraph","inlines":[{"type":"text","text":"Retained","marks":[]}]}','Retained','{"type":"authored"}');
   INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at) VALUES(1,1,1,1,1);
   INSERT INTO study_document_inputs(version_id,position,message_version_id) VALUES(1,0,1);
   UPDATE study_document_versions SET status='published',published_at=2 WHERE id=1;`);
      assert.equal(
        db.orm.get(sql`SELECT hash FROM __drizzle_migrations WHERE name=${applied}`)?.hash,
        appliedHash
      );
      db.close();
      db = undefined;
      db = Db.open(path);
      assert.equal(
        db.orm.get(sql`SELECT exact_message_version_id FROM study_document_inputs`)
          ?.exact_message_version_id,
        1n
      );
      assert.equal(db.orm.get(sql`SELECT text FROM blocks WHERE document_id=1`)?.text, 'Retained');
      db.exec('DELETE FROM sessions WHERE id=1;');
      assert.deepEqual(
        {
          ...db.orm.get(
            sql`SELECT message_version_id,exact_message_version_id FROM study_document_inputs`
          )
        },
        { message_version_id: null, exact_message_version_id: 1n }
      );
      assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
      const reference = Db.open(':memory:');
      try {
        assert.equal(db.schemaIdentity(), reference.schemaIdentity());
      } finally {
        reference.close();
      }
      const backup = join(folder, 'intermediate-backup.db');
      await db.snapshot(backup);
      assert.equal(Db.validateSnapshot(backup), db.schemaIdentity());
      const schema = db.schemaIdentity();
      db.close();
      db = undefined;
      db = Db.open(path);
      assert.equal(db.schemaIdentity(), schema);
      assert.equal(db.orm.get(sql`SELECT count(*) AS n FROM study_documents`)?.n, 1n);
      assert.equal(
        db.orm.get(sql`SELECT count(*) AS n FROM __drizzle_migrations WHERE name=${applied}`)?.n,
        1n
      );
    } finally {
      db?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);

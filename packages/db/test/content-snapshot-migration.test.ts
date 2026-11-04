import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testMigration } from '@study/testing/node';
import { sql } from 'drizzle-orm';

import { Db } from '../src/index.ts';
import { assertFinalStorage } from './final-storage.ts';

testMigration({ migration: 'document_domains_cutover', retention: 'permanent' })(
  'content snapshot migration preserves anchored content, exact references and backup restore',
  async () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-content-migration-'));
    const previous = join(folder, 'migrations');
    const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
    let connection: Db | undefined;

    mkdirSync(previous);

    try {
      for (const name of readdirSync(migrations))
        if (name <= '20261103163715_jittery_moondragon')
          cpSync(join(migrations, name), join(previous, name), { recursive: true });

      const path = join(folder, 'study.db');

      connection = Db.open(path, previous);
      connection.exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES (7,'attachment','text','text/plain','Retained source',8,zeroblob(32),1);
      INSERT INTO source_blobs(source_id,bytes) VALUES (7,X'52657461696E6564');
      INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime)
      VALUES (7,3,X'52657461696E6564','text','text/plain');
      INSERT INTO documents(id,source_id,extractor_version,meta,created_at)
      VALUES (42,7,0,'{"refiners":[]}',1);
      INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
      VALUES (42,0,'paragraph','retained-block',
        '{"type":"paragraph","inlines":[{"type":"text","text":"Retained","marks":[]}]}',
        'Retained','{"type":"page","page":2}');
      INSERT INTO source_processing(source_id,revision,request_id,published_request_id,document_id)
      VALUES (7,3,'captured-source','captured-source',42);
      INSERT INTO sessions(id,title,title_source,created_at,updated_at)
      VALUES (9,'Retained session','user',1,1);
      INSERT INTO messages(id,session_id,role,created_at) VALUES (10,9,'assistant',1);
      INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at)
      VALUES (11,10,1,'answer','complete','Retained answer',1);
      INSERT INTO citations(version_id,marker,source_id,document_id,block_id,source_name,anchor,quote)
      VALUES (11,1,7,42,'retained-block','Retained source','{"type":"page","page":2}','Retained');`);
      const triggers = connection.orm.all<{ name: string }>(
        sql`SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN('chunks_fts_ai','chunks_fts_au','chunks_fts_ad','message_fts_ai','message_fts_ad','message_fts_finish') ORDER BY name`
      );

      connection.close();
      connection = Db.open(path);

      assert.equal(connection.orm.get(sql`SELECT id FROM content_snapshots WHERE id=42`)?.id, 42n);
      assert.equal(
        connection.orm.get(sql`SELECT text FROM blocks WHERE document_id=42`)?.text,
        'Retained'
      );
      assert.deepEqual(
        {
          ...connection.orm.get(sql`SELECT source_id,revision,document_id FROM source_processing`)
        },
        { source_id: 7n, revision: 3n, document_id: 42n }
      );
      assert.deepEqual(
        {
          ...connection.orm.get(sql`SELECT c.document_id,c.block_id,b.text
        FROM citations c JOIN blocks b ON b.document_id=c.document_id AND b.editing_id=c.block_id
        WHERE c.version_id=11 AND c.marker=1`)
        },
        { document_id: 42n, block_id: 'retained-block', text: 'Retained' }
      );
      assertFinalStorage(connection);
      assert.equal(
        connection.orm.get(
          sql`SELECT source_revision FROM citations WHERE version_id=11 AND marker=1`
        )?.source_revision,
        3n
      );
      assert.deepEqual(connection.orm.all(sql`PRAGMA foreign_key_check`), []);
      assert.deepEqual(
        connection.orm
          .all(
            sql`SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN('chunks_fts_ai','chunks_fts_au','chunks_fts_ad','message_fts_ai','message_fts_ad','message_fts_finish') ORDER BY name`
          )
          .filter((row) => triggers.some((trigger) => trigger.name === row.name)),
        triggers
      );
      assert.equal(
        connection.orm.get(
          sql`SELECT name FROM sqlite_schema WHERE type='table' AND name='documents'`
        ),
        undefined
      );
      const backupPath = join(folder, 'snapshot.db');
      const identity = connection.contentIdentity();

      await connection.snapshot(backupPath);
      assert.equal(Db.validateSnapshot(backupPath), connection.schemaIdentity());
      const restored = Db.openSnapshot(backupPath);

      try {
        assert.equal(restored.contentIdentity(), identity);
        assert.deepEqual(restored.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        restored.close();
      }
    } finally {
      connection?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);

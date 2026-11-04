import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { createTestDatabase } from '../src/testing.ts';

function fixture(t: TestContext) {
  const location = createTestDatabase();
  const db = location.open();

  t.onTestFinished(() => {
    db.close();
    location.cleanup();
  });
  db.exec(`INSERT INTO content_snapshots(id,extractor_version,meta,created_at)
    VALUES (1,0,'{}',1),(2,0,'{}',1),(3,0,'{}',1);
    INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
    SELECT id,0,'paragraph','block-'||id,
      '{"type":"paragraph","inlines":[{"type":"text","text":"Authored","marks":[]}]}',
      'Authored','{"type":"authored"}' FROM content_snapshots;
    INSERT INTO study_documents(id,title,created_at,updated_at)
    VALUES (1,'First',1,1),(2,'Second',1,1);
    INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at)
    VALUES (1,1,1,1,1),(2,1,2,2,1),(3,2,1,3,1);`);

  return db;
}

testStable(
  'authored documents have independent identity and survive all session links being removed',
  (t) => {
    const db = fixture(t);

    db.exec(`INSERT INTO sessions(id,title,title_source,created_at,updated_at)
    VALUES (1,'One','user',1,1),(2,'Two','user',1,1);
    INSERT INTO session_documents(session_id,document_id,position) VALUES (1,1,0),(1,2,1),(2,1,0);
    DELETE FROM sessions;`);
    assert.strictEqual(db.orm.get(sql`SELECT count(*) AS n FROM study_documents`)?.n, 2n);
    assert.strictEqual(db.orm.get(sql`SELECT count(*) AS n FROM study_document_versions`)?.n, 3n);
    assert.strictEqual(db.orm.get(sql`SELECT count(*) AS n FROM session_documents`)?.n, 0n);
    expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
  }
);

testStable('authored ancestry and edit receipts cannot refer to another document', (t) => {
  const db = fixture(t);

  db.exec(`UPDATE study_document_versions SET status='published',published_at=2 WHERE id IN (1,3);
    INSERT INTO study_document_version_parents(version_id,parent_version_id,document_id)
    VALUES (2,1,1);`);
  assert.throws(() =>
    db.exec(`INSERT INTO study_document_version_parents
    (version_id,parent_version_id,document_id) VALUES (2,3,1)`)
  );
  db.exec(`UPDATE study_document_versions SET status='published',published_at=3 WHERE id=2`);
  assert.throws(() =>
    db.exec(`INSERT INTO study_document_edit_receipts
    (document_id,key,operation,intent,expected_version_id,current_version_id,submitted_version_id,outcome)
    VALUES (1,'forged','save','{}',1,1,3,'saved')`)
  );
  db.exec(`INSERT INTO study_document_edit_receipts
    (document_id,key,operation,intent,expected_version_id,current_version_id,submitted_version_id,outcome)
    VALUES (1,'save','save','{}',1,1,2,'saved');`);
  assert.throws(() => db.exec(`UPDATE study_document_edit_receipts SET intent='{"changed":true}'`));
});

testStable(
  'publication seals authored versions, ancestry and canonical blocks at SQLite level',
  (t) => {
    const db = fixture(t);

    db.exec(`UPDATE study_document_versions SET status='published',published_at=2 WHERE id=1;
    INSERT INTO study_document_version_parents(version_id,parent_version_id,document_id)
    VALUES (2,1,1);
    UPDATE study_document_versions SET status='published',published_at=3 WHERE id=2;`);
    assert.throws(() => db.exec(`UPDATE study_document_versions SET creator='agent' WHERE id=1`));
    assert.throws(() => db.exec(`DELETE FROM study_document_versions WHERE id=1`));
    assert.throws(() => db.exec(`UPDATE content_snapshots SET meta='{"changed":true}' WHERE id=1`));
    assert.throws(() => db.exec(`UPDATE blocks SET text='Changed' WHERE document_id=1`));
    assert.throws(() => db.exec(`DELETE FROM blocks WHERE document_id=1`));
    assert.throws(() => db.exec(`DELETE FROM study_document_version_parents WHERE version_id=2`));
    assert.throws(() =>
      db.exec(`INSERT INTO study_document_version_parents
    (version_id,parent_version_id,document_id) VALUES (1,2,1)`)
    );
    expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
  }
);

testStable('publication cannot use empty, source-owned or already-owned snapshots', (t) => {
  const db = fixture(t);

  db.exec(`INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES (4,0,'{}',1);
    INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at)
    VALUES (4,1,3,4,1);`);
  assert.throws(() =>
    db.exec(`UPDATE study_document_versions SET status='published',published_at=2 WHERE id=4`)
  );
  db.exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at)
    VALUES (7,'attachment','text','text/plain','Source',1,zeroblob(32),1);
    INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at)
    VALUES (5,7,0,'{}',1);`);
  assert.throws(() =>
    db.exec(`INSERT INTO study_document_versions
    (document_id,number,content_snapshot_id,created_at) VALUES (1,4,5,1)`)
  );
  assert.throws(() =>
    db.exec(`INSERT INTO study_document_versions
    (document_id,number,content_snapshot_id,created_at) VALUES (2,2,1,1)`)
  );
});

testStable(
  'superseded generic document kinds and payload storage cannot claim authored snapshots',
  (t) => {
    const db = fixture(t);

    assert.throws(() =>
      db.exec(
        `INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES (77,'document','Bypass',1,1)`
      )
    );
    assert.strictEqual(
      db.orm.get(sql`SELECT 1 FROM sqlite_schema WHERE name='material_document_versions'`),
      undefined
    );
    assert.strictEqual(db.orm.get(sql`SELECT count(*) n FROM study_document_versions`)?.n, 3n);
  }
);

testStable('authored publication rejects an exact input draft or retired dependent body', (t) => {
  const db = fixture(t);

  db.exec(
    `INSERT INTO study_document_inputs(version_id,position,document_version_id) VALUES(1,0,3);`
  );
  assert.throws(() =>
    db.exec(`UPDATE study_document_versions SET status='published',published_at=2 WHERE id=1`)
  );
  db.exec(
    `UPDATE study_document_versions SET status='published',published_at=2 WHERE id=3; UPDATE study_document_versions SET status='published',published_at=2 WHERE id=1;`
  );
  assert.throws(() =>
    db.exec(
      `INSERT INTO study_document_retirements(version_id,reason,created_at) VALUES(3,'history',3)`
    )
  );
  expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
});

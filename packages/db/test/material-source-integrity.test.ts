import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { sql } from 'drizzle-orm';

import { createTestDatabase } from '../src/testing.ts';

type TestDb = ReturnType<ReturnType<typeof createTestDatabase>['open']>;
function source(db: TestDb, kind: 'audio' | 'video' | 'image' | 'link' = 'audio') {
  const mime = {
    audio: 'audio/wav',
    video: 'video/mp4',
    image: 'image/png',
    link: 'text/uri-list'
  }[kind];
  db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Media',1,1);
 INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,uri,created_at)
 VALUES(1,1,'attachment','${kind}','${mime}','original',1,zeroblob(32),${kind === 'link' ? "'https://example.com/original'" : 'NULL'},1);
 INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'01');
 INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime,uri)
 SELECT id,1,X'01',kind,mime,uri FROM sources;
 INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(1,1,1,'{}',1);
 INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
 VALUES(1,0,'paragraph','original','{"type":"paragraph","inlines":[{"type":"text","text":"Original","marks":[]}]}','Original','{"type":"page","page":1}');
 INSERT INTO source_processing(source_id,revision,request_id,published_request_id,document_id) VALUES(1,1,'original','original',1);
 INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'diagram','Learning',1,1);
 INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'diagram',1,1);
 INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','flowchart LR; A-->B');`);
}
function fixture(run: (db: TestDb) => void) {
  const location = createTestDatabase();
  const db = location.open();
  try {
    run(db);
    assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
  } finally {
    db.close();
    location.cleanup();
  }
}
function pin(db: TestDb, revision = 1, snapshotId = 1) {
  db.exec(
    `INSERT INTO material_evidence_inputs(version_id,position,source_id,source_revision,source_snapshot_id) VALUES(1,0,1,${revision},${snapshotId})`
  );
}

testStable(
  'learning consumes an immutable exact source extraction rather than a source-backed Material',
  () =>
    fixture((db) => {
      source(db);
      for (const [revision, snapshot] of [
        [0, 1],
        [2, 1],
        [1, 999]
      ])
        assert.throws(() => pin(db, revision, snapshot));
      pin(db);
      db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=1");
      for (const statement of [
        'UPDATE material_evidence_inputs SET source_revision=2 WHERE version_id=1',
        'DELETE FROM material_evidence_inputs WHERE version_id=1',
        "UPDATE source_snapshots SET bytes=X'ff' WHERE source_id=1 AND revision=1",
        'DELETE FROM source_extraction_revisions WHERE source_id=1'
      ])
        assert.throws(() => db.exec(statement));
      assert.equal(db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 1n);
    })
);

testStable(
  'publishing a learning draft after source replacement keeps its captured old extraction',
  () =>
    fixture((db) => {
      source(db);
      pin(db);
      db.exec(`INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,2,X'020304','text','text/plain');
 UPDATE sources SET kind='text',mime='text/plain',name='replacement.txt',size_bytes=3 WHERE id=1;
 UPDATE source_blobs SET bytes=X'020304' WHERE source_id=1;
 UPDATE source_processing SET revision=2,request_id='replacement',published_request_id=NULL,document_id=NULL WHERE source_id=1;
 UPDATE material_versions SET status='published',published_at=3 WHERE id=1;`);
      assert.deepEqual(
        db.orm.get(
          sql`SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=1`
        ),
        { source_id: 1n, source_revision: 1n, source_snapshot_id: 1n }
      );
      assert.deepEqual(
        db.orm.get(sql`SELECT bytes FROM source_snapshots WHERE revision=1`)?.bytes,
        new Uint8Array([1])
      );
    })
);

testStable('exact source ownership rejects another source paired with the original snapshot', () =>
  fixture((db) => {
    source(db);
    db.exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(2,'attachment','text','text/plain','Other',1,zeroblob(32),1);
 INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(2,1,X'02','text','text/plain');`);
    assert.throws(() =>
      db.exec(
        'INSERT INTO material_evidence_inputs(version_id,position,source_id,source_revision,source_snapshot_id) VALUES(1,0,2,1,1)'
      )
    );
    assert.throws(() =>
      db.exec(
        'INSERT INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(2,1,1)'
      )
    );
    pin(db);
    assert.throws(() =>
      db.exec('UPDATE material_evidence_inputs SET source_id=2 WHERE version_id=1')
    );
  })
);

for (const kind of ['audio', 'video', 'image', 'link'] as const)
  testStable(
    `retained ${kind} source revisions seal exact format, URI and bytes independently of replacement`,
    () =>
      fixture((db) => {
        source(db, kind);
        const original = db.orm.get(
          sql`SELECT * FROM source_snapshots WHERE source_id=1 AND revision=1`
        );
        pin(db);
        db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=1");
        db.exec(`INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,2,X'020304','text','text/plain');
  UPDATE sources SET kind='text',mime='text/plain',uri=NULL,size_bytes=3 WHERE id=1;
  UPDATE source_blobs SET bytes=X'020304' WHERE source_id=1;
  UPDATE source_processing SET revision=2,request_id='replacement',published_request_id=NULL,document_id=NULL WHERE source_id=1;`);
        for (const patch of [
          "bytes=X'ff'",
          "kind='text'",
          "mime='application/octet-stream'",
          "uri='https://example.com/forged'",
          'revision=2',
          'source_id=2'
        ])
          assert.throws(() =>
            db.exec(`UPDATE source_snapshots SET ${patch} WHERE source_id=1 AND revision=1`)
          );
        assert.throws(() =>
          db.exec('DELETE FROM source_snapshots WHERE source_id=1 AND revision=1')
        );
        assert.deepEqual(
          db.orm.get(sql`SELECT * FROM source_snapshots WHERE source_id=1 AND revision=1`),
          original
        );
        assert.equal(
          db.orm.get(sql`SELECT mime FROM source_snapshots WHERE revision=2`)?.mime,
          'text/plain'
        );
        assert.equal(
          db.orm.get(
            sql`SELECT count(*) n FROM materials WHERE kind IN ('file','audio','video','image','link','document')`
          )?.n,
          0n
        );
      })
  );

import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { sql } from 'drizzle-orm';

import { createTestDatabase } from '../src/testing.ts';

function sourceDraft(
  db: ReturnType<ReturnType<typeof createTestDatabase>['open']>,
  kind: 'audio' | 'video' | 'image' | 'link' = 'audio'
) {
  const mime = {
    audio: 'audio/wav',
    video: 'video/mp4',
    image: 'image/png',
    link: 'text/uri-list'
  }[kind];

  db.exec(`
    INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Media',1,1);
    INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(1,1,'attachment','${kind}','${mime}','original',1,zeroblob(32),1);
    INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'01');
    INSERT INTO source_processing(source_id,revision,request_id) VALUES(1,1,'one');
    INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,1,X'01','${kind}','${mime}');
    INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'${kind}','Recording',1,1);
    INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'${kind}',1,1);
    INSERT INTO material_${kind}_versions(version_id,source_id) VALUES(1,1);
    ${kind === 'link' ? "UPDATE sources SET uri='https://example.com/original' WHERE id=1; UPDATE source_snapshots SET uri='https://example.com/original' WHERE source_id=1;" : ''}
  `);
}

function pin(db: ReturnType<ReturnType<typeof createTestDatabase>['open']>) {
  db.exec(`INSERT INTO material_source_snapshots(version_id,source_id,revision,metadata)
    SELECT 1,id,1,json_object('id',CAST(id AS TEXT),'projectId',CAST(project_id AS TEXT),'projectName','Media','name',name,'kind',kind,'mime',mime,'origin',origin,'sizeBytes',CAST(size_bytes AS TEXT),'sha256',lower(hex(sha256)),'uri',uri,'createdAt',CAST(created_at AS TEXT)) FROM sources WHERE id=1`);
}

testStable('source-backed publication requires an immutable pin', () => {
  const location = createTestDatabase();
  const db = location.open();

  try {
    sourceDraft(db);
    assert.throws(() =>
      db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=1")
    );
    pin(db);
    db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=1");
    assert.throws(() =>
      db.exec("UPDATE material_source_snapshots SET metadata='{}' WHERE version_id=1")
    );
    assert.throws(() => db.exec('DELETE FROM material_source_snapshots WHERE version_id=1'));
    db.exec(`INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(2,1,'audio',2,1);
      INSERT INTO material_audio_versions(version_id,source_id) VALUES(2,1);
      INSERT INTO material_source_snapshots(version_id,source_id,revision,metadata) SELECT 2,source_id,revision,metadata FROM material_source_snapshots WHERE version_id=1;`);
    assert.throws(
      () => db.exec('UPDATE material_source_snapshots SET version_id=1 WHERE version_id=2'),
      (error: unknown) => error instanceof Error && 'errcode' in error && error.errcode === 1811
    );
  } finally {
    db.close();
    location.cleanup();
  }
});

testStable('publishing an old audio draft validates its pinned revision after replacement', () => {
  const location = createTestDatabase();
  const db = location.open();

  try {
    sourceDraft(db);
    pin(db);
    db.exec(`UPDATE sources SET name='image.png',kind='image',mime='image/png' WHERE id=1;
      UPDATE source_blobs SET bytes=X'02' WHERE source_id=1;
      INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,2,X'02','image','image/png');
      UPDATE source_processing SET revision=2,request_id='two' WHERE source_id=1;`);
    assert.doesNotThrow(() =>
      db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=1")
    );
  } finally {
    db.close();
    location.cleanup();
  }
});

testStable(
  'publication rejects a draft pin that no longer matches its typed payload source',
  () => {
    const location = createTestDatabase();
    const db = location.open();

    try {
      sourceDraft(db);
      pin(db);
      db.exec(`INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(2,1,'attachment','audio','audio/wav','other.wav',1,zeroblob(32),1);
      INSERT INTO source_blobs(source_id,bytes) VALUES(2,X'02');
      UPDATE material_audio_versions SET source_id=2 WHERE version_id=1;`);
      assert.throws(() =>
        db.exec("UPDATE material_versions SET status='published',published_at=2 WHERE id=1")
      );
    } finally {
      db.close();
      location.cleanup();
    }
  }
);

for (const kind of ['audio', 'video', 'image', 'link'] as const)
  testStable(`bound ${kind} format revisions retain exact metadata, source and byte pins`, () => {
    const location = createTestDatabase();
    const db = location.open();

    try {
      sourceDraft(db, kind);
      pin(db);
      db.exec(`UPDATE material_versions SET status='published',published_at=2 WHERE id=1;
        INSERT INTO material_imports(source_id,material_id) VALUES(1,1);
        INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime)
          VALUES(1,2,X'020304','text','text/plain');
        INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(2,1,'${kind}',2,3);
        INSERT INTO material_${kind}_versions(version_id,source_id) VALUES(2,1);
        INSERT INTO material_source_snapshots(version_id,source_id,revision,metadata)
          SELECT 2,source_id,2,json_set(metadata,'$.kind','text','$.mime','text/plain','$.uri',NULL,'$.sizeBytes','3')
          FROM material_source_snapshots WHERE version_id=1;`);

      const valid = db.orm.get<{ metadata: string }>(
        sql`SELECT metadata FROM material_source_snapshots WHERE version_id=2`
      )!.metadata;
      const publish = () =>
        db.exec("UPDATE material_versions SET status='published',published_at=4 WHERE id=2");
      const constraint = (error: unknown) =>
        error instanceof Error && 'errcode' in error && error.errcode === 1811;

      for (const patch of [
        { id: '2' },
        { kind: kind },
        { mime: 'application/octet-stream' },
        { uri: 'https://example.com/forged' },
        { sizeBytes: '1' }
      ]) {
        db.orm.run(
          sql`UPDATE material_source_snapshots SET metadata=${JSON.stringify({ ...JSON.parse(valid), ...patch })} WHERE version_id=2`
        );
        assert.throws(publish, constraint, JSON.stringify(patch));
      }

      db.orm.run(sql`UPDATE material_source_snapshots SET metadata=${valid} WHERE version_id=2`);
      // The metadata for revision 2 must not validate against revision 1's bytes/format.
      db.exec('UPDATE material_source_snapshots SET revision=1 WHERE version_id=2');
      assert.throws(publish, constraint);
      db.exec('UPDATE material_source_snapshots SET revision=2 WHERE version_id=2');
      db.exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at)
        VALUES(2,'attachment','text','text/plain','Other',3,zeroblob(32),1);
        INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(2,2,X'020304','text','text/plain');`);
      assert.throws(
        () => db.exec('UPDATE material_source_snapshots SET source_id=2 WHERE version_id=2'),
        constraint
      );
      db.exec(`UPDATE material_${kind}_versions SET source_id=2 WHERE version_id=2`);
      assert.throws(publish, constraint);
      db.exec(`UPDATE material_${kind}_versions SET source_id=1 WHERE version_id=2`);
      assert.doesNotThrow(publish);
      assert.throws(
        () => db.exec("UPDATE source_snapshots SET bytes=X'ff' WHERE source_id=1 AND revision=2"),
        constraint
      );
      assert.throws(
        () => db.exec("UPDATE material_source_snapshots SET metadata='{}' WHERE version_id=2"),
        constraint
      );
      assert.equal(db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM materials`)!.n, 1n);
    } finally {
      db.close();
      location.cleanup();
    }
  });

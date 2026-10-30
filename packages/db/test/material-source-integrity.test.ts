import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestDatabase } from '../src/testing.ts';

function sourceDraft(db: ReturnType<ReturnType<typeof createTestDatabase>['open']>) {
  db.exec(`
    INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Media',1,1);
    INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(1,1,'attachment','audio','audio/wav','recording.wav',1,zeroblob(32),1);
    INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'01');
    INSERT INTO source_processing(source_id,revision,request_id) VALUES(1,1,'one');
    INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,1,X'01','audio','audio/wav');
    INSERT INTO materials(id,project_id,kind,title,created_at,updated_at) VALUES(1,1,'audio','Recording',1,1);
    INSERT INTO material_versions(id,material_id,project_id,kind,number,created_at) VALUES(1,1,1,'audio',1,1);
    INSERT INTO material_audio_versions(version_id,source_id) VALUES(1,1);
  `);
}

function pin(db: ReturnType<ReturnType<typeof createTestDatabase>['open']>) {
  db.exec(`INSERT INTO material_source_snapshots(version_id,source_id,revision,metadata)
    SELECT 1,id,1,json_object('id',CAST(id AS TEXT),'projectId',CAST(project_id AS TEXT),'projectName','Media','name',name,'kind',kind,'mime',mime,'origin',origin,'sizeBytes',CAST(size_bytes AS TEXT),'sha256',lower(hex(sha256)),'uri',uri,'createdAt',CAST(created_at AS TEXT)) FROM sources WHERE id=1`);
}

test('source-backed publication requires an immutable pin', () => {
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
    db.exec(`INSERT INTO material_versions(id,material_id,project_id,kind,number,created_at) VALUES(2,1,1,'audio',2,1);
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

test('publishing an old audio draft validates its pinned revision after replacement', () => {
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

test('publication rejects a draft pin that no longer matches its typed payload source', () => {
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
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql as dbSql } from 'drizzle-orm';

import { Db } from '../src/index.ts';

test('migrated pruning guards retain current roots, require exact proof and forbid body resurrection', () => {
  const db = Db.open(':memory:');

  try {
    db.exec(`INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'diagram','History',1,1);

      INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'diagram',1,1),(2,1,'diagram',2,1);

      INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','graph TD; Old'),(2,'mermaid','graph TD; Current');

      UPDATE material_versions SET status='published',published_at=2;`);

    assert.throws(() => db.exec('DELETE FROM material_diagram_versions WHERE version_id=1'));

    assert.throws(() => db.exec("UPDATE material_versions SET instruction='tampered' WHERE id=1"));

    db.exec(
      `INSERT INTO material_history_prunes(operation_id,material_id,keep_latest,token,selection,status,created_at) VALUES('prune',1,1,'${'a'.repeat(64)}','["1","2"]','pending',3);`
    );

    assert.throws(() =>
      db.exec("INSERT INTO material_history_members(version_id,operation_id) VALUES(2,'prune')")
    );

    db.exec("INSERT INTO material_history_members(version_id,operation_id) VALUES(1,'prune')");

    assert.throws(() =>
      db.exec("UPDATE material_diagram_versions SET payload='restored' WHERE version_id=1")
    );

    db.exec('DELETE FROM material_diagram_versions WHERE version_id=1');

    assert.throws(() =>
      db.exec(
        "INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','restored')"
      )
    );

    assert.throws(() => db.exec('UPDATE material_versions SET number=9 WHERE id=1'));

    assert.throws(() => db.exec('DELETE FROM material_history_members WHERE version_id=1'));

    assert.throws(() => db.exec('DELETE FROM material_diagram_versions WHERE version_id=2'));

    assert.equal(
      db.orm.get<{ n: bigint }>(
        dbSql`SELECT count(*) n FROM material_diagram_versions WHERE version_id=2`
      )?.n,
      1n
    );
  } finally {
    db.close();
  }
});

test('upgraded membership proof counts retained newer roots and binds exact operation and candidate ownership', () => {
  const db = Db.open(':memory:');

  try {
    db.exec(`INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'diagram','History',1,1),(2,'diagram','Other',1,1);

      INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'diagram',1,1),(2,1,'diagram',2,1),(3,1,'diagram',3,1),(4,2,'diagram',1,1);

      INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','old'),(2,'mermaid','middle'),(3,'mermaid','current'),(4,'mermaid','other');

      UPDATE material_versions SET status='published',published_at=2;

      INSERT INTO material_history_prunes(operation_id,material_id,keep_latest,token,selection,status,created_at)
      VALUES('middle',1,1,'${'b'.repeat(64)}','["2"]','pending',3);

      INSERT INTO material_history_members(version_id,operation_id) VALUES(2,'middle');

      DELETE FROM material_diagram_versions WHERE version_id=2;

      UPDATE material_history_prunes SET status='completed',completed_at=4 WHERE operation_id='middle';

      INSERT INTO material_history_prunes(operation_id,material_id,keep_latest,token,selection,status,created_at)
      VALUES('keep-two',1,2,'${'c'.repeat(64)}','["1","3"]','pending',5);`);

    // Version 2 is a tombstone: only version 3 still counts toward keepLatest.

    for (const id of [1, 3, 4])
      assert.throws(() =>
        db.exec(
          `INSERT INTO material_history_members(version_id,operation_id) VALUES(${id},'keep-two')`
        )
      );

    db.exec(`UPDATE material_history_prunes SET status='completed',completed_at=6 WHERE operation_id='keep-two';

      INSERT INTO material_history_prunes(operation_id,material_id,keep_latest,token,selection,status,created_at)
      VALUES('exact',1,1,'${'d'.repeat(64)}','["1"]','pending',6);`);

    assert.throws(() =>
      db.exec("INSERT INTO material_history_members(version_id,operation_id) VALUES(3,'exact')")
    );

    db.exec("INSERT INTO material_history_members(version_id,operation_id) VALUES(1,'exact')");

    assert.throws(() =>
      db.exec("UPDATE material_history_members SET operation_id='keep-two' WHERE version_id=1")
    );

    assert.throws(() => db.exec('DELETE FROM material_versions WHERE id=1'));

    assert.throws(() =>
      db.exec("UPDATE material_diagram_versions SET payload='resurrected' WHERE version_id=1")
    );

    db.exec('DELETE FROM material_diagram_versions WHERE version_id=1');

    assert.throws(() =>
      db.exec(
        "INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','resurrected')"
      )
    );

    assert.equal(
      db.orm.get<{ n: bigint }>(
        dbSql`SELECT count(*) n FROM material_diagram_versions WHERE version_id IN(3,4)`
      )?.n,
      2n
    );

    assert.deepEqual(db.orm.all(dbSql`PRAGMA foreign_key_check`), []);
  } finally {
    db.close();
  }
});

test('exact attachment Source and Document proofs reject forged context ownership on the migrated schema', () => {
  const db = Db.open(':memory:');

  try {
    db.exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(1,'attachment','text','text/plain','source.txt',1,zeroblob(32),1),(2,'attachment','text','text/plain','other.txt',1,zeroblob(32),1);

      INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'01'),(2,X'02');

      INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,1,X'01','text','text/plain'),(2,1,X'02','text','text/plain');

      INSERT INTO documents(id,source_id,extractor_version,meta,created_at) VALUES(1,1,1,'{}',1),(2,1,1,'{}',1);

      INSERT INTO source_processing(source_id,revision,request_id,published_request_id,document_id) VALUES(1,1,'current','current',2);

      INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'file','Source',1,1);

      INSERT INTO material_versions(id,material_id,kind,number,operation,created_at)
        VALUES(1,1,'file',1,'original',1),(2,1,'file',2,'extract',1),(3,1,'file',3,'extract',1);

      INSERT INTO material_file_versions(version_id,source_id) VALUES(1,1),(2,1),(3,1);

      INSERT INTO material_source_snapshots(version_id,source_id,revision,document_id,metadata)
      SELECT v.id,1,1,NULL,
        json_object('id','1','projectId',NULL,'projectName',NULL,'name','source.txt','kind','text','mime','text/plain','origin','attachment','sizeBytes','1','sha256',lower(hex(zeroblob(32))),'uri',NULL,'createdAt','1')
      FROM material_versions v;

      UPDATE material_versions SET status='published',published_at=2 WHERE id=1;

      INSERT INTO material_imports(material_id,source_id) VALUES(1,1);

      UPDATE material_source_snapshots SET document_id=CASE version_id WHEN 2 THEN 1 ELSE 2 END WHERE version_id IN(2,3);

      INSERT INTO blocks(document_id,ordinal,editing_id,kind,content,text,anchor)
      VALUES(1,0,'old-block','paragraph','{"type":"paragraph","inlines":[{"type":"text","text":"Old","marks":[]}]}','Old','{"type":"paragraph","index":0}'),
        (2,0,'current-block','paragraph','{"type":"paragraph","inlines":[{"type":"text","text":"Current","marks":[]}]}','Current','{"type":"paragraph","index":0}');

      UPDATE documents SET meta='{"extractor":null,"extractorVersion":1,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false,"omissions":[]}';

      UPDATE material_versions SET status='published',published_at=2 WHERE id IN(2,3);

      INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Session','user',1,1);

      INSERT INTO messages(id,session_id,role,created_at) VALUES(1,1,'assistant',1),(2,1,'assistant',1),(3,1,'assistant',1);

      INSERT INTO message_versions(id,message_id,number,origin,status,created_at) VALUES(1,1,1,'answer','pending',1),(2,2,1,'answer','pending',1),(3,3,1,'answer','pending',1);`);

    for (const [requestId, versionId, sourceId, documentId] of [
      ['exact', 1, '1', '1'],
      ['wrong-source', 2, '2', '1'],
      ['wrong-document', 3, '1', '2']
    ] as const) {
      db.orm.run(
        dbSql`INSERT INTO conversation_reply_requests(request_id,session_id,version_id,snapshot) VALUES(${requestId},1,${versionId},${JSON.stringify({ context: { inputs: [] }, messages: [{ attachments: [{ sourceId, documentId }] }] })})`
      );
    }

    db.exec(`INSERT INTO material_history_prunes(operation_id,material_id,keep_latest,token,selection,status,created_at)
      VALUES('attachments',1,1,'${'e'.repeat(64)}','["1","2","3"]','pending',3);`);

    assert.throws(() =>
      db.exec(
        "INSERT INTO material_history_members(version_id,operation_id) VALUES(1,'attachments')"
      )
    );

    assert.throws(() =>
      db.exec(
        "INSERT INTO material_history_members(version_id,operation_id) VALUES(3,'attachments')"
      )
    );

    db.exec(
      "INSERT INTO material_history_members(version_id,operation_id) VALUES(2,'attachments')"
    );

    db.exec(
      "INSERT INTO source_history_documents(operation_id,document_id) VALUES('attachments',1)"
    );

    assert.throws(() =>
      db.exec(
        "INSERT INTO source_history_documents(operation_id,document_id) VALUES('attachments',2)"
      )
    );

    for (const requestId of ['wrong-source', 'wrong-document', 'unrelated-correlation']) {
      assert.throws(() =>
        db.orm.run(
          dbSql`INSERT INTO material_history_requests(request_id,operation_id,kind) VALUES(${requestId},'attachments','context')`
        )
      );
    }

    db.exec(
      "INSERT INTO material_history_requests(request_id,operation_id,kind) VALUES('exact','attachments','context')"
    );

    assert.throws(() =>
      db.exec("UPDATE material_history_requests SET kind='publication' WHERE request_id='exact'")
    );

    assert.throws(() => db.exec('DELETE FROM source_history_documents WHERE document_id=1'));

    assert.throws(() => db.exec('DELETE FROM documents WHERE id=2'));

    assert.throws(() => db.exec('DELETE FROM source_snapshots WHERE source_id=1 AND revision=1'));

    assert.deepEqual(db.orm.all(dbSql`PRAGMA foreign_key_check`), []);
  } finally {
    db.close();
  }
});

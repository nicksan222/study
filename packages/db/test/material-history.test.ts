import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { sql as dbSql } from 'drizzle-orm';

import { Db } from '../src/index.ts';

testStable(
  'migrated pruning guards retain current roots, require exact proof and forbid body resurrection',
  () => {
    const db = Db.open(':memory:');

    try {
      db.exec(`INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'diagram','History',1,1);

      INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'diagram',1,1),(2,1,'diagram',2,1);

      INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','graph TD; Old'),(2,'mermaid','graph TD; Current');

      UPDATE material_versions SET status='published',published_at=2;`);

      assert.throws(() => db.exec('DELETE FROM material_diagram_versions WHERE version_id=1'));

      assert.throws(() =>
        db.exec("UPDATE material_versions SET instruction='tampered' WHERE id=1")
      );

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
  }
);

testStable(
  'upgraded membership proof counts retained newer roots and binds exact operation and candidate ownership',
  () => {
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
  }
);

testStable(
  'exact raw attachment pins reject forged source or extraction ownership while preserving current source roots',
  () => {
    const db = Db.open(':memory:');

    try {
      db.exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(1,'attachment','text','text/plain','source.txt',1,zeroblob(32),1),(2,'attachment','text','text/plain','other.txt',1,zeroblob(32),1);
  INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'01'),(2,X'02');
  INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,1,X'01','text','text/plain'),(2,1,X'02','text','text/plain');
  INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(1,1,1,'{}',1),(2,1,1,'{}',1),(3,2,1,'{}',1);
  INSERT INTO blocks(document_id,ordinal,editing_id,kind,content,text,anchor) SELECT id,0,'block-'||id,'paragraph','{"type":"paragraph","inlines":[{"type":"text","text":"Evidence","marks":[]}]}','Evidence','{"type":"paragraph","index":0}' FROM content_snapshots;
  INSERT INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(1,1,1),(2,1,3);
  INSERT INTO source_processing(source_id,revision,request_id,published_request_id,document_id) VALUES(1,1,'current','current',2);
  INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Session','user',1,1);
  INSERT INTO messages(id,session_id,role,created_at) VALUES(1,1,'assistant',1),(2,1,'assistant',1),(3,1,'assistant',1);
  INSERT INTO message_versions(id,message_id,number,origin,status,created_at) VALUES(1,1,1,'answer','pending',1),(2,2,1,'answer','pending',1),(3,3,1,'answer','pending',1);`);

      for (const [requestId, versionId, sourceId, snapshotId] of [
        ['exact', 1, '1', '1'],
        ['wrong-source', 2, '2', '1'],
        ['wrong-document', 3, '1', '2']
      ] as const)
        db.orm.run(
          dbSql`INSERT INTO conversation_reply_requests(request_id,session_id,version_id,snapshot) VALUES(${requestId},1,${versionId},${JSON.stringify({ messages: [{ attachments: [{ partId: '1', sourceId, revision: '1', snapshotId }] }] })})`
        );

      db.exec(
        "INSERT INTO conversation_reply_sources(request_id,part_id,source_id,revision,snapshot_id) VALUES('exact',1,1,1,1)"
      );
      assert.throws(() =>
        db.exec(
          "INSERT INTO conversation_reply_sources(request_id,part_id,source_id,revision,snapshot_id) VALUES('wrong-source',1,2,1,1)"
        )
      );
      assert.throws(() =>
        db.exec(
          "INSERT INTO conversation_reply_sources(request_id,part_id,source_id,revision,snapshot_id) VALUES('wrong-document',1,1,1,1)"
        )
      );

      for (const statement of [
        "UPDATE conversation_reply_sources SET snapshot_id=2 WHERE request_id='exact'",
        "DELETE FROM conversation_reply_sources WHERE request_id='exact'",
        'DELETE FROM source_extraction_revisions WHERE snapshot_id=1',
        'DELETE FROM content_snapshots WHERE id=1',
        'DELETE FROM content_snapshots WHERE id=2',
        'DELETE FROM source_snapshots WHERE source_id=1 AND revision=1'
      ])
        assert.throws(() => db.exec(statement));

      db.exec(
        'DELETE FROM sessions WHERE id=1; DELETE FROM source_extraction_revisions WHERE snapshot_id=1; DELETE FROM content_snapshots WHERE id=1'
      );
      assert.equal(db.orm.get(dbSql`SELECT 1 FROM content_snapshots WHERE id=1`), undefined);
      assert.equal(
        db.orm.get(dbSql`SELECT document_id FROM source_processing WHERE source_id=1`)?.document_id,
        2n
      );
      assert.deepEqual(db.orm.all(dbSql`PRAGMA foreign_key_check`), []);
    } finally {
      db.close();
    }
  }
);

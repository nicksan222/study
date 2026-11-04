import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testMigration } from '@study/testing/node';
import { sql } from 'drizzle-orm';

import { Db } from '../src/index.ts';
import { assertFinalStorage } from './final-storage.ts';
import { requireRow } from './rows.ts';

const meta = JSON.stringify({
  extractor: null,
  extractorVersion: 0,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
});
const block = (id: number, text: string) =>
  `INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(${id},0,'paragraph','block-${id}','{"type":"paragraph","inlines":[{"type":"text","text":"${text}","marks":[]}]}','${text}','{"type":"authored"}');`;

testMigration({ migration: 'document_domains_cutover', retention: 'permanent' })(
  'final atomic delta captures the last old writer, removes every bridge, and fences unsupported private native work',
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-final-cutover-'));
    const official = fileURLToPath(new URL('../drizzle', import.meta.url));
    const migrations = process.env.STUDY_FINAL_MIGRATIONS ?? official;
    const before = join(folder, 'before');
    mkdirSync(before);
    let db: Db | undefined;
    try {
      for (const name of readdirSync(official))
        if (name < '20261104020301')
          cpSync(join(official, name), join(before, name), { recursive: true });
      const path = join(folder, 'study.db');
      db = Db.open(path, before);
      db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1);
      INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(9,'Raw session','user',1,1);
      INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(1,'attachment','text','text/plain','Original',1,zeroblob(32),1);
      INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,1,x'61','text','text/plain');
      INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(100,1,0,'${meta}',1);
      ${block(100, 'Source body')}
      INSERT INTO source_processing(source_id,revision,request_id,published_request_id,document_id) VALUES(1,1,'source-1','source-1',100);
      INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(5,'file','Original',1,1),(6,'document','Last old authored output',1,1),(7,'diagram','Learning',1,1);
      INSERT INTO material_versions(id,material_id,kind,number,created_at,creator) VALUES(50,5,'file',1,1,'import');
      INSERT INTO material_file_versions(version_id,source_id) VALUES(50,1);
      INSERT INTO material_source_snapshots(version_id,source_id,revision,document_id,metadata) VALUES(50,1,1,NULL,json_object('id','1','projectId',NULL,'projectName',NULL,'name','Original','kind','text','mime','text/plain','origin','attachment','sizeBytes','1','sha256',lower(hex(zeroblob(32))),'uri',NULL,'createdAt','1'));
      UPDATE material_versions SET status='published',published_at=1 WHERE id=50;
      INSERT INTO material_imports(source_id,material_id) VALUES(1,5);
      INSERT INTO material_versions(id,material_id,kind,number,operation,creator,created_at) VALUES(51,5,'file',2,'extract','import',1);
      INSERT INTO material_file_versions(version_id,source_id) VALUES(51,1);
      INSERT INTO material_source_snapshots(version_id,source_id,revision,document_id,metadata) VALUES(51,1,1,100,json_object('id','1','projectId',NULL,'projectName',NULL,'name','Original','kind','text','mime','text/plain','origin','attachment','sizeBytes','1','sha256',lower(hex(zeroblob(32))),'uri',NULL,'createdAt','1'));
      UPDATE material_versions SET status='published',published_at=1 WHERE id=51;
      INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(200,0,'${meta}',1),(300,0,'${meta}',1);
      ${block(200, 'Late body')}${block(300, 'Native body')}
      INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(60,6,'document',1,1),(70,7,'diagram',1,1);
      INSERT INTO material_document_versions(version_id,document_id) VALUES(60,200);
      INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(70,'mermaid','graph TD; A-->B');
      INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(60,51);
      UPDATE material_versions SET status='published',published_at=1 WHERE id=60;
      INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(70,60);
      UPDATE material_versions SET status='published',published_at=1 WHERE id=70;
      INSERT INTO project_materials(project_id,material_id) VALUES(1,6),(1,7);
      INSERT INTO session_materials(session_id,material_id,position) VALUES(9,5,0),(9,6,1);
      INSERT INTO study_documents(id,title,created_at,updated_at) VALUES(1,'Native owner',1,1);
      INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at) VALUES(1,1,1,300,1);
      UPDATE study_document_versions SET status='published',published_at=1 WHERE id=1;
      INSERT INTO messages(id,session_id,role,created_at) VALUES(1,9,'assistant',1);
      INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(1,1,1,'answer','complete','Completed raw answer',1);
      UPDATE messages SET active_version_id=1 WHERE id=1;
      INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot) VALUES('old-context',9,'old-key','{}','{"requestId":"old-context","sessionId":"9","inputs":[],"private":"captured body"}');
      INSERT INTO conversation_reply_requests(request_id,session_id,version_id,snapshot) VALUES('old-context',9,1,'{"requestId":"old-context","messages":[],"private":"captured body"}');
      INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,owner_token,created_at,updated_at) VALUES('old-native','ConversationReplyWorkflow',1,'{"event":{"type":"ConversationGenerationRequested","correlationId":"old-context"},"private":"captured body"}','running','owner',1,1);
      INSERT INTO workflow_activities(execution_id,name,attempt,result) VALUES('old-native','capture',0,'{"private":"captured body"}');`);
      db.close();
      db = Db.open(path, migrations);
      assertFinalStorage(db);
      const late = db.orm.get(
        sql`SELECT id FROM study_documents WHERE title='Last old authored output'`
      )!.id;
      assert.equal(
        requireRow(
          db.orm.get(
            sql`SELECT text FROM blocks b JOIN study_document_versions v ON v.content_snapshot_id=b.document_id WHERE v.document_id=${late}`
          )
        ).text,
        'Late body'
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT text FROM blocks WHERE document_id=300`)).text,
        'Native body'
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT document_id FROM session_documents WHERE session_id=9`))
          .document_id,
        late
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT source_id FROM session_sources WHERE session_id=9`))
          .source_id,
        1n
      );
      assert.equal(
        requireRow(
          db.orm.get(
            sql`SELECT document_version_id FROM material_evidence_inputs WHERE version_id=70`
          )
        ).document_version_id,
        requireRow(
          db.orm.get(sql`SELECT id FROM study_document_versions WHERE document_id=${late}`)
        ).id
      );
      assert.equal(requireRow(db.orm.get(sql`SELECT count(*) n FROM materials`)).n, 1n);
      assert.equal(requireRow(db.orm.get(sql`SELECT count(*) n FROM source_snapshots`)).n, 1n);
      assert.equal(
        requireRow(db.orm.get(sql`SELECT text FROM message_versions WHERE id=1`)).text,
        'Completed raw answer'
      );
      assert.equal(
        db.orm.get(sql`SELECT 1 FROM session_run_contexts WHERE request_id='old-context'`),
        undefined
      );
      assert.equal(
        db.orm.get(sql`SELECT 1 FROM conversation_reply_requests WHERE request_id='old-context'`),
        undefined
      );
      assert.equal(
        requireRow(
          db.orm.get(sql`SELECT request_id FROM session_retired_intents WHERE intent_key='old-key'`)
        ).request_id,
        'old-context'
      );
      assert.deepEqual(
        {
          ...db.orm.get(
            sql`SELECT payload,owner_token,status FROM workflow_executions WHERE execution_id='old-native'`
          )
        },
        { payload: '{}', owner_token: null, status: 'cancelled' }
      );
      assert.equal(
        db.orm.get(sql`SELECT 1 FROM workflow_activities WHERE execution_id='old-native'`),
        undefined
      );
      assert.throws(() =>
        db!.exec(
          "INSERT INTO materials(kind,title,created_at,updated_at) VALUES('document','Bypass',1,1)"
        )
      );
      assert.throws(() =>
        db!.exec(
          'INSERT INTO material_generation_requests(id,project_id,payload,created_at) VALUES(\'bypass\',1,\'{"kind":"document"}\',1)'
        )
      );
      const identity = db.schemaIdentity();
      db.close();
      db = Db.open(path, migrations);
      assert.equal(db.schemaIdentity(), identity);
      assertFinalStorage(db);
    } finally {
      db?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);

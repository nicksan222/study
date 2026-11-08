import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { integrationPlanSchema } from '@study/contracts/integrations/schemas';
import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Db, sql } from '../src/index.ts';

const migration = '20261108023348_notes-pages';

function row(db: Db, statement: string) {
  return db.orm.get(sql.raw(statement));
}

function assertPreferences(db: Db) {
  expect(
    row(db, "SELECT value FROM preferences WHERE scope='workspace' AND key='sidebarShowPageCounts'")
      ?.value
  ).toBe('true');
  expect(
    row(db, "SELECT value FROM preferences WHERE scope='agent-rules' AND key='pages'")?.value
  ).toBe('"Use documentId in prose"');
  expect(
    row(db, "SELECT value FROM preferences WHERE scope='workspace' AND key='autoTitleNotes'")
  ).toStrictEqual({ value: 'true' });
}

function assertDurableReplay(db: Db) {
  expect(
    JSON.parse(String(row(db, 'SELECT selection FROM notes WHERE id=1')?.selection))
  ).toStrictEqual([{ input: { kind: 'page', versionId: '1' }, scope: { kind: 'document' } }]);
  assertPreferences(db);
  const context = JSON.parse(String(row(db, 'SELECT snapshot FROM note_run_contexts')?.snapshot));

  expect(context.noteId).toBe('1');
  expect(context.includedNotes).toStrictEqual([{ noteId: '1' }]);
  expect(context.inputs[0]).toStrictEqual({
    input: { kind: 'page', versionId: '1' },
    pageId: '1',
    snapshotId: '1',
    scope: { kind: 'document' }
  });
  expect(row(db, 'SELECT id,intent_hash,note_id FROM page_transform_requests')).toStrictEqual({
    id: 'document/capture',
    intent_hash: 'a'.repeat(64),
    note_id: 1n
  });
  expect(
    JSON.parse(
      String(row(db, "SELECT payload FROM workflow_events WHERE event_id='source-event'")?.payload)
    )
  ).toStrictEqual({ type: 'SourceIndexed', sourceId: '1', documentId: '2' });
  expect(row(db, "SELECT type FROM workflow_events WHERE event_id='event'")?.type).toBe(
    'NoteTitleRequested'
  );
  expect(row(db, 'SELECT workflow_tag FROM workflow_executions')?.workflow_tag).toBe(
    'conversation-title/v1'
  );
  expect(row(db, 'SELECT subscription,execution_id FROM workflow_receipts')).toStrictEqual({
    subscription: 'conversation-title',
    execution_id: 'execution'
  });
  const result = JSON.parse(String(row(db, 'SELECT result FROM workflow_activities')?.result));

  expect(result.page.version.pageId).toBe('1');
  expect(result.page.version.document.documentId).toBe('canonical-metadata');
  expect(result.source).toStrictEqual({
    id: '42',
    kind: 'document',
    name: 'Original.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    meta: { documentId: 'keep', sessionId: 'keep', documents: 'keep' }
  });
  expect(row(db, 'SELECT name,input,result FROM assistant_tool_receipts')).toStrictEqual({
    name: 'save_page',
    input: '{"expectedVersionId":"1","pageId":"1"}',
    result: '{"version":{"pageId":"1"},"pageId":"1"}'
  });
  expect(row(db, 'SELECT agent FROM ai_usage')?.agent).toBe('page-transform');
  expect(result.notes).toStrictEqual([{ id: '1', title: 'Lecture' }]);
  expect(result.pages).toStrictEqual({ items: [{ id: '1', title: 'Summary' }], nextCursor: null });
  expect(result.inputs).toStrictEqual([{ kind: 'page', versionId: '1' }]);
}

testStable(
  'Notes and Pages upgrade preserves authored content, exact evidence and durable replay',
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-notes-pages-'));
    const previous = join(folder, 'previous');
    const path = join(folder, 'study.sqlite');
    const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
    let db: Db | undefined;

    try {
      for (const name of readdirSync(migrations))
        if (name < migration)
          cpSync(join(migrations, name), join(previous, name), { recursive: true });

      db = Db.open(path, previous);
      db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Biology',1,1);
      INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Lecture','user',1,1),(99,'Deleted','user',1,1);
      DELETE FROM sessions WHERE id=99;
      INSERT INTO project_sessions(project_id,session_id) VALUES(1,1);
      INSERT INTO study_documents(id,title,created_at,updated_at) VALUES(1,'Summary',1,1),(99,'Deleted',1,1);
      DELETE FROM study_documents WHERE id=99;
      INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(1,0,'{}',1),(2,0,'{}',1);
      INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
        SELECT id,0,'paragraph','block-'||id,'{"type":"paragraph","inlines":[{"type":"text","text":"sessionId documentId document","marks":[]}]}','sessionId documentId document','{"type":"authored"}' FROM content_snapshots;
      INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at) VALUES(1,1,1,1,1),(2,1,2,2,1);
      UPDATE study_document_versions SET status='published',published_at=2 WHERE id=1;
      INSERT INTO study_document_version_parents(version_id,parent_version_id,document_id) VALUES(2,1,1);
      UPDATE study_document_versions SET status='published',published_at=3 WHERE id=2;
      INSERT INTO study_document_edit_receipts(document_id,key,operation,intent,expected_version_id,current_version_id,submitted_version_id,outcome)
        VALUES(1,'save','save','"digest-kept"',1,1,2,'saved');
      INSERT INTO project_documents(project_id,document_id) VALUES(1,1);
      INSERT INTO session_documents(session_id,document_id,position) VALUES(1,1,0);
      UPDATE sessions SET selection='[{"input":{"kind":"document","versionId":"1"},"scope":{"kind":"document"}}]' WHERE id=1;
      INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot)
        VALUES('capture',1,'intent','{"sessionId":"1","additionalSessionIds":["1"],"instruction":"documentId must stay in prose"}',
          '{"requestId":"capture","sessionId":"1","includedSessions":[{"sessionId":"1"}],"inputs":[{"input":{"kind":"document","versionId":"1"},"documentId":"1","snapshotId":"1","scope":{"kind":"document"}}],"messages":[]}');
      INSERT INTO session_context_documents(request_id,version_id) VALUES('capture',1);
      INSERT INTO study_document_transform_requests(id,context_request_id,session_id,request,intent_hash,instruction,event_id,created_at)
        VALUES('document/capture','capture',1,'{"contextRequestId":"capture","operations":["clarity"],"title":"Summary"}','${'a'.repeat(64)}','Clarify','event',1);
      INSERT INTO workflow_events(event_id,type,correlation_id,input_version,depth,payload,created_at)
        VALUES('event','ConversationTitleRequested','document/capture',1,0,'{"type":"ConversationTitleRequested","sessionId":"1","eventId":"event"}',1),
          ('source-event','SourceIndexed','source',1,0,'{"type":"SourceIndexed","sourceId":"1","documentId":"2"}',1);
      INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,created_at,updated_at)
        VALUES('execution','conversation-title/v1',1,'{"event":{"type":"ConversationTitleRequested","sessionId":"1"}}','suspended',1,1);
      INSERT INTO workflow_receipts(event_id,subscription,workflow_version,input_version,execution_id,created_at)
        VALUES('event','conversation-title',1,1,'execution',1);
      INSERT INTO workflow_activities(execution_id,name,attempt,result)
        VALUES('execution','captured-result',0,'{"document":{"id":"1","title":"Summary","version":{"documentId":"1","document":{"blocks":[{"type":"text","text":"sessionId documentId"}],"documentId":"canonical-metadata"}}},"inputs":[{"kind":"document","versionId":"1"}],"sessions":[{"id":"1","title":"Lecture"}],"documents":{"items":[{"id":"1","title":"Summary"}],"nextCursor":null},"source":{"id":"42","kind":"document","name":"Original.docx","mime":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","meta":{"documentId":"keep","sessionId":"keep","documents":"keep"}}}');
      INSERT INTO messages(id,session_id,role,created_at) VALUES(1,1,'assistant',1);
      INSERT INTO message_versions(id,message_id,number,origin,status,created_at) VALUES(1,1,1,'answer','pending',1);
      INSERT INTO assistant_tool_receipts(version_id,name,ordinal,input,result)
        VALUES(1,'save_document',0,'{"documentId":"1","expectedVersionId":"1"}','{"documentId":"1","version":{"documentId":"1"}}');
      INSERT INTO ai_usage(id,runId,agent,provider,model,timestamp,input,cacheRead,cacheWrite,output,reasoning,incomplete)
        VALUES('usage','run','document-transform','chatgpt','model',1,1,0,0,1,0,0);
      INSERT INTO integration_imports(id,provider_id,source_key,state,created_at)
        VALUES('12345678-1234-4234-8234-123456789012','obsidian','vault','{"plan":{"sessions":[{"key":"lesson","title":"Lesson","text":"Original prose documentId sessionId","metadata":null,"attachments":[],"links":[]}],"files":[],"warnings":[]}}',1);
      INSERT INTO workflow_retired_correlations(correlation_id,event_type) VALUES('retired','ConversationGenerationRequested');
      INSERT INTO preferences(scope,key,value) VALUES('workspace','autoTitleSessions','true'),('workspace','sidebarShowDocumentCounts','true'),('agent-rules','documents','"Use documentId in prose"');`);
      const blocks = db.orm.all(sql`SELECT * FROM blocks ORDER BY document_id`);
      const triggerCount = row(db, "SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger'");

      db.close();
      db = Db.open(path);
      expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      expect(db.orm.all(sql`SELECT * FROM blocks ORDER BY document_id`)).toStrictEqual(blocks);
      expect(row(db, "SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger'")).toStrictEqual(
        triggerCount
      );
      expect(row(db, 'SELECT note_id,page_id,position FROM note_pages')).toStrictEqual({
        note_id: 1n,
        page_id: 1n,
        position: 0n
      });
      expect(row(db, 'SELECT note_id,project_id FROM project_notes')).toStrictEqual({
        note_id: 1n,
        project_id: 1n
      });
      expect(row(db, 'SELECT page_id,project_id FROM project_pages')).toStrictEqual({
        page_id: 1n,
        project_id: 1n
      });
      expect(row(db, 'SELECT page_id,intent FROM page_edit_receipts')).toStrictEqual({
        page_id: 1n,
        intent: '"digest-kept"'
      });
      assertDurableReplay(db);
      const imported = JSON.parse(String(row(db, 'SELECT state FROM integration_imports')!.state));

      expect(Schema.decodeUnknownSync(integrationPlanSchema)(imported.plan).notes[0]?.text).toBe(
        'Original prose documentId sessionId'
      );
      assert.throws(() => db!.exec('UPDATE page_edit_receipts SET intent=\'"changed"\''));
      assert.throws(() => db!.exec("UPDATE blocks SET text='Changed' WHERE document_id=1"));
      assert.throws(() =>
        db!.exec(
          'UPDATE notes SET selection=\'[{"input":{"kind":"page","versionId":"999"},"scope":{"kind":"document"}}]\' WHERE id=1'
        )
      );
      db.exec(
        "INSERT INTO notes(title,title_source,created_at,updated_at) VALUES('Next','user',2,2); INSERT INTO pages(title,created_at,updated_at) VALUES('Next',2,2);"
      );
      expect(row(db, 'SELECT max(id) AS id FROM notes')?.id).toBe(100n);
      expect(row(db, 'SELECT max(id) AS id FROM pages')?.id).toBe(100n);
    } finally {
      db?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);

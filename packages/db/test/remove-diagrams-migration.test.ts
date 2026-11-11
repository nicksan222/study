import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { Db, sql } from '../src/index.ts';

const migration = '20261111132528_absent_shiver_man';

function seedContent(db: Db) {
  db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Keep project',1,1);
    INSERT INTO notes(id,title,title_source,created_at,updated_at) VALUES(1,'Keep note','user',1,1);
    INSERT INTO preferences(scope,key,value) VALUES('workspace','keep','true'),('agent-rules','diagrams','"Remove rule"'),('agent-rules','quizzes','"Keep rule"');
    INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(1,1,'attachment','audio','audio/wav','Keep source',1,zeroblob(32),1);
    INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'01');
    INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime)
      SELECT id,1,X'01',kind,mime FROM sources;
    INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(1,1,1,'{}',1);
    INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
      VALUES(1,0,'paragraph','original','{"type":"paragraph","inlines":[{"type":"text","text":"Original","marks":[]}]}','Original','{"type":"page","page":1}');
    INSERT INTO source_processing(source_id,revision,request_id,published_request_id,document_id)
      VALUES(1,1,'original','original',1);
    INSERT INTO materials(id,kind,title,created_at,updated_at)
      VALUES(1,'diagram','Remove diagram',1,1),(2,'quiz','Keep quiz',1,1),(3,'flashcards','Keep cards',1,1);
    INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(10,'diagram','-',1,1);
    INSERT INTO material_deletions(material_id,operation_id,selection,status,phase,created_at,completed_at)
      VALUES(10,'retired-diagram','["10"]','pending','accepted',1,NULL);
    INSERT INTO material_deletion_members(material_id,deletion_id) VALUES(10,10);
    INSERT INTO material_versions(id,material_id,kind,number,created_at)
      VALUES(1,1,'diagram',1,1),(4,1,'diagram',2,1),(2,2,'quiz',1,1),(3,3,'flashcards',1,1);
    INSERT INTO material_diagram_versions(version_id,format,payload)
      VALUES(1,'mermaid','graph TD; A-->B'),(4,'mermaid','graph TD; A-->C');
    INSERT INTO material_quiz_versions(version_id) VALUES(2);
    INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation)
      VALUES(2,2,0,'open','Keep question','Keep explanation');
    INSERT INTO material_quiz_open_answers(question_id,reference_answer) VALUES(2,'Keep answer');
    INSERT INTO material_flashcard_versions(version_id,material_id) VALUES(3,3);
    INSERT INTO material_card_identities(id,material_id) VALUES(1,3);
    INSERT INTO material_flashcard_entries(version_id,material_id,card_id,position,front,back)
      VALUES(3,3,1,0,'Keep front','Keep back');
    INSERT INTO project_materials(project_id,material_id) VALUES(1,1),(1,2),(1,3);
    INSERT INTO note_materials(note_id,material_id,position) VALUES(1,1,0),(1,2,1);
    INSERT INTO material_evidence_inputs(id,version_id,position,source_id,source_revision,source_snapshot_id)
      VALUES(1,1,0,1,1,1);
    INSERT INTO material_evidence_citations(version_id,marker,input_id,anchor,quote)
      VALUES(1,1,1,'{"type":"page","page":1}','Original');
    UPDATE material_versions SET status='published',published_at=2 WHERE id IN(1,2,3);
    INSERT INTO material_version_parents(version_id,parent_version_id,material_id) VALUES(4,1,1);
    UPDATE material_versions SET status='published',published_at=2 WHERE id=4;
    INSERT INTO material_history_prunes(operation_id,material_id,keep_latest,token,selection,status,created_at)
      VALUES('diagram-history',1,1,replace(hex(zeroblob(32)),'0','a'),'["1"]','pending',3);
    INSERT INTO material_history_members(version_id,operation_id) VALUES(1,'diagram-history');`);
}

function seedWorkflows(db: Db) {
  for (const [kind, id] of [
    ['diagram', 'diagram-job'],
    ['quiz', 'keep-job']
  ] as const) {
    const input = { kind: 'source', sourceId: '1', revision: '1', snapshotId: '1' };
    const event = {
      type: 'MaterialGenerationRequested',
      eventId: id,
      requestId: id,
      correlationId: id,
      causationId: null,
      inputVersion: 1,
      depth: 0,
      kind,
      projectId: '1'
    };

    db.orm.run(sql`INSERT INTO material_generation_requests(id,project_id,payload,created_at)
      VALUES(${id},1,${JSON.stringify({ kind, title: id, instruction: 'Generate', inputs: [input] })},1)`);
    db.orm
      .run(sql`INSERT INTO material_evidence_inputs(request_id,position,source_id,source_revision,source_snapshot_id)
      VALUES(${id},0,1,1,1)`);
    db.orm
      .run(sql`INSERT INTO workflow_events(event_id,type,correlation_id,input_version,depth,payload,created_at)
      VALUES(${id},'MaterialGenerationRequested',${id},1,0,${JSON.stringify(event)},1)`);
    db.orm
      .run(sql`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,owner_token,created_at,updated_at)
      VALUES(${id},'material-generation/v1',1,${JSON.stringify({ event })},'suspended','owner',1,1)`);
    db.orm
      .run(sql`INSERT INTO workflow_receipts(event_id,subscription,workflow_version,input_version,execution_id,created_at)
      VALUES(${id},'material-generation',1,1,${id},1)`);
    db.orm.run(
      sql`INSERT INTO workflow_activities(execution_id,name,attempt,result) VALUES(${id},'capture',0,'{}')`
    );
    db.orm.run(
      sql`INSERT INTO workflow_deferreds(execution_id,name,result) VALUES(${id},'wait','{}')`
    );
    db.orm.run(
      sql`INSERT INTO workflow_clocks(execution_id,name,deferred_name,due_at) VALUES(${id},'retry','wait',1)`
    );
    db.orm
      .run(sql`INSERT INTO workflow_configuration_waits(execution_id,deferred_name,observed_revision,reason)
      VALUES(${id},'wait','0','auth')`);
    db.orm
      .run(sql`INSERT INTO workflow_agent_progress(run_id,execution_id,owner_token,activity_name,attempt,agent_id,mode,status,revision,updated_at)
      VALUES(${id},${id},'owner','capture',0,${kind},'object','running',1,1)`);
  }

  db.exec(`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,parent_execution_id,created_at,updated_at)
    VALUES('diagram-child','nested/v1',1,'{}','suspended','diagram-job',1,1);`);
}

function assertPreserved(db: Db) {
  expect(db.orm.all(sql`SELECT id,kind FROM materials ORDER BY id`)).toStrictEqual([
    { id: 2n, kind: 'quiz' },
    { id: 3n, kind: 'flashcards' }
  ]);
  expect(db.orm.all(sql`SELECT id FROM material_versions ORDER BY id`)).toStrictEqual([
    { id: 2n },
    { id: 3n }
  ]);
  expect(db.orm.all(sql`SELECT execution_id FROM workflow_executions`)).toStrictEqual([
    { execution_id: 'keep-job' }
  ]);
  expect(db.orm.all(sql`SELECT id FROM material_generation_requests`)).toStrictEqual([
    { id: 'keep-job' }
  ]);

  for (const table of [
    'workflow_activities',
    'workflow_clocks',
    'workflow_deferreds',
    'workflow_receipts',
    'workflow_agent_progress',
    'workflow_configuration_waits'
  ])
    expect(db.orm.all(sql.raw(`SELECT execution_id FROM ${table}`))).toStrictEqual([
      { execution_id: 'keep-job' }
    ]);

  expect(db.orm.all(sql`SELECT event_id FROM workflow_events`)).toStrictEqual([
    { event_id: 'keep-job' }
  ]);
  expect(
    db.orm.all(sql`SELECT material_id FROM project_materials ORDER BY material_id`)
  ).toStrictEqual([{ material_id: 2n }, { material_id: 3n }]);
  expect(db.orm.all(sql`SELECT material_id FROM note_materials`)).toStrictEqual([
    { material_id: 2n }
  ]);
  expect(db.orm.all(sql`SELECT name FROM sources`)).toStrictEqual([{ name: 'Keep source' }]);
  expect(db.orm.all(sql`SELECT title FROM notes`)).toStrictEqual([{ title: 'Keep note' }]);
  expect(db.orm.all(sql`SELECT value FROM preferences WHERE key='keep'`)).toStrictEqual([
    { value: 'true' }
  ]);
  expect(
    db.orm.all(sql`SELECT key,value FROM preferences WHERE scope='agent-rules'`)
  ).toStrictEqual([{ key: 'quizzes', value: '"Keep rule"' }]);
  expect(db.orm.all(sql`SELECT front,back FROM material_flashcard_entries`)).toStrictEqual([
    { front: 'Keep front', back: 'Keep back' }
  ]);
  expect(db.orm.all(sql`SELECT reference_answer FROM material_quiz_open_answers`)).toStrictEqual([
    { reference_answer: 'Keep answer' }
  ]);

  for (const table of [
    'material_version_parents',
    'material_history_prunes',
    'material_history_members',
    'material_evidence_citations'
  ])
    expect(db.orm.all(sql.raw(`SELECT * FROM ${table}`))).toStrictEqual([]);

  expect(db.orm.all(sql`SELECT request_id FROM material_evidence_inputs`)).toStrictEqual([
    { request_id: 'keep-job' }
  ]);
  expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
  expect(
    db.orm.all(
      sql`SELECT name FROM sqlite_schema WHERE name='material_diagram_versions' OR (type='trigger' AND instr(sql,'material_diagram_versions')>0)`
    )
  ).toStrictEqual([]);
  expect(() => db.exec("UPDATE materials SET kind='quiz' WHERE id=3")).toThrow();
  expect(() =>
    db.exec("UPDATE material_flashcard_entries SET front='changed' WHERE version_id=3")
  ).toThrow();
  expect(() => db.exec('DELETE FROM material_versions WHERE id=2')).toThrow();
}

testStable(
  'migration deletes diagram ancestry, evidence and pending work while preserving unrelated content',
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-remove-diagrams-'));
    const previous = join(folder, 'previous');
    const path = join(folder, 'study.sqlite');
    const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
    let db: Db | undefined;

    try {
      for (const name of readdirSync(migrations))
        if (name < migration)
          cpSync(join(migrations, name), join(previous, name), { recursive: true });

      db = Db.open(path, previous);
      seedContent(db);
      seedWorkflows(db);
      db.close();
      db = undefined;
      db = Db.open(path);
      assertPreserved(db);
      db.close();
      db = undefined;
      db = Db.open(path);
      assertPreserved(db);
      db.exec(
        "INSERT INTO materials(kind,title,created_at,updated_at) VALUES('quiz','New quiz',3,3)"
      );
      expect(db.orm.all(sql`SELECT id FROM materials WHERE title='New quiz'`)).toStrictEqual([
        { id: 11n }
      ]);
      db.exec(
        "INSERT INTO material_versions(material_id,kind,number,created_at) VALUES(11,'quiz',1,3)"
      );
      expect(db.orm.all(sql`SELECT material_id FROM material_deletion_members`)).toStrictEqual([
        { material_id: 10n }
      ]);
    } finally {
      db?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { sql } from 'drizzle-orm';

import { Db } from '../src/index.ts';
import { material_quiz_choices } from '../src/schema.ts';

function fixture(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'study-materials-'));
  const db = Db.open(join(folder, 'study.db'));

  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  db.exec(`
    INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Math',1,1),(2,'Other',1,1);
    INSERT INTO sessions(id,project_id,title,title_source,created_at,updated_at)
      VALUES(1,1,'Lecture','user',1,1),(2,2,'Other','user',1,1);
  `);

  return db;
}

function draft(db: Db, id: bigint, kind = 'diagram', material = id, project = 1n) {
  db.orm.run(sql`INSERT INTO materials(id,project_id,kind,title,created_at,updated_at)
    VALUES(${material},${project},${kind},'Material',1,1) ON CONFLICT(id) DO NOTHING`);
  db.orm.run(sql`INSERT INTO material_versions(id,material_id,project_id,kind,number,created_at)
    VALUES(${id},${material},${project},${kind},${id},1)`);
}

function diagram(db: Db, id: bigint) {
  draft(db, id);
  db.orm.run(sql`INSERT INTO material_diagram_versions(version_id,format,payload)
    VALUES(${id},'mermaid','graph TD; A-->B')`);
}

function pinSource(db: Db, versionId: bigint, sourceId = 1n) {
  db.orm.run(sql`INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime,uri)
    SELECT s.id,1,coalesce(b.bytes,X''),s.kind,s.mime,s.uri FROM sources s LEFT JOIN source_blobs b ON b.source_id=s.id
    WHERE s.id=${sourceId} ON CONFLICT DO NOTHING`);
  db.orm.run(sql`INSERT INTO material_source_snapshots(version_id,source_id,revision,metadata)
    SELECT ${versionId},s.id,1,json_object('id',CAST(s.id AS TEXT),'projectId',CAST(s.project_id AS TEXT),'projectName',p.name,'name',s.name,'kind',s.kind,'mime',s.mime,'origin',s.origin,'sizeBytes',CAST(s.size_bytes AS TEXT),'sha256',lower(hex(s.sha256)),'uri',s.uri,'createdAt',CAST(s.created_at AS TEXT))
    FROM sources s LEFT JOIN projects p ON p.id=s.project_id WHERE s.id=${sourceId}`);
}

function publish(db: Db, id: bigint) {
  db.orm.run(sql`UPDATE material_versions SET status='published',published_at=2 WHERE id=${id}`);
}

test('materials enforce kind, project membership and version ownership with direct SQL', (t) => {
  const db = fixture(t);

  diagram(db, 1n);
  db.exec(
    'INSERT INTO session_materials(session_id,material_id,project_id,position) VALUES(1,1,1,0)'
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO materials(project_id,kind,title,created_at,updated_at) VALUES(1,'mystery','No',1,1)"
    )
  );
  assert.throws(() =>
    db.exec(
      'INSERT INTO session_materials(session_id,material_id,project_id,position) VALUES(2,1,1,0)'
    )
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO material_versions(material_id,project_id,kind,number,created_at) VALUES(1,1,'quiz',2,1)"
    )
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO material_versions(material_id,project_id,kind,number,created_at) VALUES(1,2,'diagram',2,1)"
    )
  );
  assert.throws(() =>
    db.exec('INSERT INTO material_file_versions(version_id,source_id) VALUES(1,123)')
  );
  assert.equal(db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM material_versions`)?.n, 1n);
});

test('publication rejects absent or incomplete payloads and freezes content and identities', (t) => {
  const db = fixture(t);

  draft(db, 1n);
  assert.throws(() => publish(db, 1n));
  db.exec(
    "INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','graph TD; A-->B')"
  );
  publish(db, 1n);
  assert.throws(() =>
    db.exec("UPDATE material_diagram_versions SET payload='changed' WHERE version_id=1")
  );
  assert.throws(() => db.exec('DELETE FROM material_diagram_versions WHERE version_id=1'));
  assert.throws(() =>
    db.exec(
      "INSERT OR REPLACE INTO material_diagram_versions(version_id,format,payload) VALUES(1,'mermaid','changed')"
    )
  );
  assert.throws(() =>
    db.exec("UPDATE material_versions SET status='draft',published_at=NULL WHERE id=1")
  );
  assert.throws(() =>
    db.exec(
      "INSERT OR REPLACE INTO material_versions(id,material_id,project_id,kind,number,created_at) VALUES(1,1,1,'diagram',1,1)"
    )
  );
  assert.throws(() => db.exec("UPDATE materials SET kind='file' WHERE id=1"));
  assert.throws(() => db.exec('DELETE FROM material_versions WHERE id=1'));
  assert.throws(() =>
    db.exec(
      "INSERT INTO material_versions(material_id,project_id,kind,number,status,created_at,published_at) VALUES(1,1,'diagram',2,'published',1,2)"
    )
  );
});

test('multi-input provenance is same-project, published-only, append-only before publication and acyclic', (t) => {
  const db = fixture(t);

  diagram(db, 1n);
  publish(db, 1n);
  diagram(db, 2n);
  publish(db, 2n);
  diagram(db, 3n);
  db.exec(
    'INSERT INTO material_version_inputs(version_id,input_version_id,project_id) VALUES(3,1,1),(3,2,1)'
  );
  assert.throws(() =>
    db.exec(
      'INSERT INTO material_version_inputs(version_id,input_version_id,project_id) VALUES(1,3,1)'
    )
  );
  assert.throws(() =>
    db.exec(
      'INSERT INTO material_version_inputs(version_id,input_version_id,project_id) VALUES(3,3,1)'
    )
  );
  diagram(db, 4n);
  assert.throws(() =>
    db.exec(
      'INSERT INTO material_version_inputs(version_id,input_version_id,project_id) VALUES(3,4,1)'
    )
  );
  draft(db, 5n, 'diagram', 5n, 2n);
  db.exec(
    "INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(5,'mermaid','graph TD; A-->B')"
  );
  publish(db, 5n);
  assert.throws(() =>
    db.exec(
      'INSERT INTO material_version_inputs(version_id,input_version_id,project_id) VALUES(3,5,1)'
    )
  );
  publish(db, 3n);
  assert.equal(
    db.orm.get<{ n: bigint }>(
      sql`SELECT count(*) AS n FROM material_version_inputs WHERE version_id=3`
    )?.n,
    2n
  );
  assert.throws(() => db.exec('DELETE FROM material_version_inputs WHERE version_id=3'));
  assert.throws(() =>
    db.exec('UPDATE material_version_inputs SET version_id=4 WHERE version_id=3')
  );
  db.exec('DELETE FROM projects WHERE id=1');
  assert.equal(
    db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM material_versions WHERE project_id=1`)
      ?.n,
    0n
  );
  assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
});

test('revision history supports branching within one material and preserves exact versions', (t) => {
  const db = fixture(t);

  diagram(db, 1n);
  publish(db, 1n);
  draft(db, 2n, 'diagram', 1n);
  db.exec(
    "INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(2,'mermaid','graph TD; A-->C')"
  );
  db.exec(
    'INSERT INTO material_version_parents(version_id,parent_version_id,material_id) VALUES(2,1,1)'
  );
  diagram(db, 3n);
  publish(db, 3n);
  assert.throws(() =>
    db.exec(
      'INSERT INTO material_version_parents(version_id,parent_version_id,material_id) VALUES(2,3,1)'
    )
  );
  publish(db, 2n);
  draft(db, 4n, 'diagram', 1n);
  db.exec(
    'INSERT INTO material_version_parents(version_id,parent_version_id,material_id) VALUES(4,1,1),(4,2,1)'
  );
  assert.equal(
    db.orm.get<{ payload: string }>(
      sql`SELECT payload FROM material_diagram_versions WHERE version_id=1`
    )?.payload,
    'graph TD; A-->B'
  );
});

test('file and media versions reuse source bytes and reject incomplete or mismatched metadata', (t) => {
  const db = fixture(t);

  db.exec(`
    INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(1,1,'import','audio','audio/wav','lecture.wav',4,zeroblob(32),1),
            (2,2,'import','audio','audio/wav','other.wav',4,zeroblob(32),1);
    INSERT INTO source_blobs(source_id,bytes) VALUES(1,x'00010203'),(2,x'00010203');
  `);
  draft(db, 1n, 'audio');
  db.exec(
    'INSERT INTO material_audio_versions(version_id,source_id,duration_ms,sample_rate,channels) VALUES(1,1,1000,48000,2)'
  );
  pinSource(db, 1n);
  publish(db, 1n);
  assert.throws(() => db.exec("UPDATE source_snapshots SET bytes=x'ff' WHERE source_id=1"));
  assert.throws(() =>
    db.exec("UPDATE material_source_snapshots SET metadata='{}' WHERE version_id=1")
  );
  assert.throws(() =>
    db.exec("INSERT OR REPLACE INTO source_blobs(source_id,bytes) VALUES(1,x'ff')")
  );
  draft(db, 2n, 'audio');
  assert.throws(() =>
    db.exec(
      'INSERT INTO material_audio_versions(version_id,source_id,duration_ms,sample_rate,channels) VALUES(2,2,1000,48000,2)'
    )
  );
  draft(db, 3n, 'audio');
  assert.throws(() =>
    db.exec('INSERT INTO material_audio_versions(version_id,source_id,duration_ms) VALUES(3,1,-1)')
  );
  assert.throws(() =>
    db.exec(
      'INSERT INTO material_audio_versions(version_id,source_id,duration_ms,channels) VALUES(3,1,1000,0)'
    )
  );
  db.exec('INSERT INTO material_audio_versions(version_id,source_id,duration_ms) VALUES(3,1,1000)');
  pinSource(db, 3n);
  publish(db, 3n);
  assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
});

test('document versions reuse anchored documents and freeze their underlying blocks', (t) => {
  const db = fixture(t);

  draft(db, 1n, 'document');
  db.exec(`
    INSERT INTO documents(id,source_id,extractor_version,meta,created_at) VALUES(1,NULL,0,'{"extractor":null,"extractorVersion":0,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false}',1);
    INSERT INTO material_document_versions(version_id,document_id) VALUES(1,1);
  `);
  assert.throws(() => publish(db, 1n));
  db.exec(
    `INSERT INTO blocks(document_id,ordinal,kind,text,anchor) VALUES(1,0,'paragraph','Derivative','{"type":"paragraph","index":0}')`
  );
  publish(db, 1n);
  assert.throws(() => db.exec("UPDATE blocks SET text='changed' WHERE document_id=1"));
  assert.throws(() => db.exec('DELETE FROM blocks WHERE document_id=1'));
  assert.throws(() =>
    db.exec(
      "INSERT INTO blocks(document_id,ordinal,kind,text,anchor) VALUES(1,1,'paragraph','more','{}')"
    )
  );
  assert.throws(() => db.exec('UPDATE documents SET meta=\'{"changed":true}\' WHERE id=1'));
});

test('project deletion purges owned files, snapshots and memberships without affecting other projects', (t) => {
  const db = fixture(t);

  db.exec(`
    INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(1,1,'import','text','text/plain','notes.txt',1,zeroblob(32),1);
    INSERT INTO source_blobs(source_id,bytes) VALUES(1,x'61');
  `);
  draft(db, 1n, 'file');
  db.exec('INSERT INTO material_file_versions(version_id,source_id) VALUES(1,1)');
  pinSource(db, 1n);
  publish(db, 1n);
  draft(db, 2n, 'document');
  db.exec(`
    INSERT INTO documents(id,extractor_version,meta,created_at) VALUES(1,0,'{"extractor":null,"extractorVersion":0,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false}',1);
    INSERT INTO blocks(document_id,ordinal,kind,text,anchor) VALUES(1,0,'paragraph','body','{"type":"paragraph","index":0}');
    INSERT INTO material_document_versions(version_id,document_id) VALUES(2,1);
    INSERT INTO material_version_inputs(version_id,input_version_id,project_id) VALUES(2,1,1);
    INSERT INTO session_materials(session_id,material_id,project_id,position) VALUES(1,1,1,0),(1,2,1,1);
  `);
  publish(db, 2n);
  draft(db, 3n, 'diagram', 3n, 2n);
  db.exec(
    "INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(3,'mermaid','graph TD; A-->B')"
  );
  publish(db, 3n);
  db.exec('DELETE FROM projects WHERE id=1');
  assert.equal(db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM sources`)?.n, 0n);
  assert.equal(db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM documents`)?.n, 0n);
  assert.equal(db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM material_versions`)?.n, 1n);
  assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
});

test('correct quiz answers roundtrip through the ORM boolean codec', (t) => {
  const db = fixture(t);

  draft(db, 1n, 'quiz');
  db.exec('INSERT INTO material_quiz_versions(version_id) VALUES(1)');
  db.exec(
    "INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES(1,1,0,'single_choice','Q','E')"
  );
  db.exec(
    "INSERT INTO material_quiz_choices(id,question_id,question_kind,position,text,is_correct) VALUES(1,1,'single_choice',0,'yes',1),(2,1,'single_choice',1,'no',0)"
  );
  assert.deepEqual(
    db.orm
      .select()
      .from(material_quiz_choices)
      .orderBy(material_quiz_choices.id)
      .all()
      .map((c) => c.is_correct),
    [true, false]
  );
});

test('draft payloads cannot pin sources from another project or move source ownership', (t) => {
  const db = fixture(t);

  db.exec(`
    INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(1,1,'import','text','text/plain','notes',1,zeroblob(32),1),
            (2,2,'import','text','text/plain','other',1,zeroblob(32),1);
    INSERT INTO source_blobs(source_id,bytes) VALUES(1,x'61'),(2,x'61');
  `);
  draft(db, 1n, 'file');
  assert.throws(() =>
    db.exec('INSERT INTO material_file_versions(version_id,source_id) VALUES(1,2)')
  );
  db.exec('INSERT INTO material_file_versions(version_id,source_id) VALUES(1,1)');
  assert.throws(() => db.exec('UPDATE sources SET project_id=2 WHERE id=1'));
  draft(db, 2n, 'document');
  db.exec(
    `INSERT INTO documents(id,source_id,extractor_version,meta,created_at) VALUES(1,2,0,'{"extractor":null,"extractorVersion":0,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false}',1)`
  );
  assert.throws(() =>
    db.exec('INSERT INTO material_document_versions(version_id,document_id) VALUES(2,1)')
  );
});

test('publication rejects malformed canonical document anchors and citations', (t) => {
  const db = fixture(t);

  draft(db, 1n, 'document');
  db.exec(
    `INSERT INTO documents(id,extractor_version,meta,created_at) VALUES(1,0,'{"extractor":null,"extractorVersion":0,"provider":null,"durationMs":null,"pageCount":null,"refiners":[],"waitingFor":[],"corrected":false}',1)`
  );
  db.exec('INSERT INTO material_document_versions(version_id,document_id) VALUES(1,1)');
  db.exec(
    `INSERT INTO blocks(document_id,ordinal,kind,text,anchor) VALUES(1,0,'paragraph','body','null')`
  );
  assert.throws(() => publish(db, 1n));
});

test('scheduling fields declared bigint reject fractional storage', (t) => {
  const db = fixture(t);

  draft(db, 1n, 'flashcards');
  db.exec('INSERT INTO material_card_identities(id,material_id) VALUES(1,1)');
  db.exec(
    "INSERT INTO material_card_schedules(card_id,due,state,stability,difficulty,reps,lapses) VALUES(1,0,'new',0,1,0,0)"
  );

  for (const name of ['last_review', 'elapsed_days', 'scheduled_days', 'learning_steps']) {
    assert.throws(() =>
      db.exec('UPDATE material_card_schedules SET ' + name + '=0.5 WHERE card_id=1')
    );
  }
});

test('removing a draft material payload preserves a source-owned extraction snapshot', (t) => {
  const db = fixture(t);

  db.exec(`
    INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
      VALUES(1,1,'import','text','text/plain','notes',1,zeroblob(32),1);
    INSERT INTO documents(id,source_id,extractor_version,meta,created_at) VALUES(1,1,0,'{}',1);
    INSERT INTO blocks(document_id,ordinal,kind,text,anchor) VALUES(1,0,'paragraph','body','{}');
  `);
  draft(db, 1n, 'document');
  db.exec('INSERT INTO material_document_versions(version_id,document_id) VALUES(1,1)');
  db.exec('DELETE FROM material_document_versions WHERE version_id=1');
  assert.equal(
    db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM documents WHERE id=1`)?.n,
    1n
  );
  assert.equal(
    db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM blocks WHERE document_id=1`)?.n,
    1n
  );
});

test('source-backed versions cannot be published without a revision pin', (t) => {
  const db = fixture(t);

  db.exec(`INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at)
    VALUES(1,1,'attachment','text','text/plain','notes',1,zeroblob(32),1);
    INSERT INTO source_blobs(source_id,bytes) VALUES(1,x'01');`);
  draft(db, 1n, 'file');
  db.exec('INSERT INTO material_file_versions(version_id,source_id) VALUES(1,1)');
  assert.throws(() => publish(db, 1n));
});

test('material citations enforce positive unsigned 32 bit markers', (t) => {
  const db = fixture(t);

  diagram(db, 1n);
  publish(db, 1n);
  diagram(db, 2n);
  db.exec(
    'INSERT INTO material_version_inputs(version_id,input_version_id,project_id) VALUES(2,1,1)'
  );
  const insert = (marker: bigint) =>
    db.orm.run(
      sql`INSERT INTO material_version_citations(version_id,marker,input_version_id,anchor,quote) VALUES(2,${marker},1,'{"type":"page","page":1}','Quote')`
    );

  for (const marker of [0n, -1n, 4294967296n]) assert.throws(() => insert(marker));

  for (const marker of [1n, 4294967295n]) insert(marker);

  assert.equal(
    db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM material_version_citations`)?.n,
    2n
  );
  assert.throws(() => insert(1n));
});

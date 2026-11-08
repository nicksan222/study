import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import type { Db } from '../src/index.ts';
import { material_quiz_choices } from '../src/schema.ts';
import { createTestDatabase } from '../src/testing.ts';

function fixture(t: TestContext) {
  const location = createTestDatabase();
  const db = location.open();

  t.onTestFinished(() => {
    db.close();
    location.cleanup();
  });
  db.exec(`
    INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Math',1,1),(2,'Other',1,1);
    INSERT INTO notes(id,title,title_source,created_at,updated_at)
      VALUES(1,'Lecture','user',1,1),(2,'Other','user',1,1);
  `);

  return db;
}

function draft(db: Db, id: bigint, kind = 'diagram', material = id) {
  db.orm.run(sql`INSERT INTO materials(id,kind,title,created_at,updated_at)
    VALUES(${material},${kind},'Material',1,1) ON CONFLICT(id) DO NOTHING`);
  db.orm.run(sql`INSERT INTO material_versions(id,material_id,kind,number,created_at)
    VALUES(${id},${material},${kind},${id},1)`);
}

function diagram(db: Db, id: bigint) {
  draft(db, id);
  db.orm.run(sql`INSERT INTO material_diagram_versions(version_id,format,payload)
    VALUES(${id},'mermaid','graph TD; A-->B')`);
}

function authored(db: Db, id: bigint, publishNow = true) {
  db.orm.run(sql`INSERT INTO pages(id,title,created_at,updated_at) VALUES(${id},'Evidence',1,1)`);
  db.orm.run(
    sql`INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(${id},1,'{}',1)`
  );
  db.orm.run(
    sql`INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(${id},0,'paragraph',${'block-' + id},'{"type":"paragraph","inlines":[{"type":"text","text":"Quote","marks":[]}]}','Quote','{"type":"authored"}')`
  );
  db.orm.run(
    sql`INSERT INTO page_versions(id,page_id,number,content_snapshot_id,created_at) VALUES(${id},${id},1,${id},1)`
  );

  if (publishNow)
    db.orm.run(sql`UPDATE page_versions SET status='published',published_at=2 WHERE id=${id}`);
}

function original(db: Db) {
  db.exec(`INSERT INTO sources(id,project_id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(1,1,'import','audio','audio/wav','lecture.wav',4,zeroblob(32),1),(2,2,'import','audio','audio/wav','other.wav',4,zeroblob(32),1);
 INSERT INTO source_blobs(source_id,bytes) VALUES(1,X'00010203'),(2,X'00010203');
 INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) SELECT id,1,X'00010203',kind,mime FROM sources;`);
}

function publish(db: Db, id: bigint) {
  db.orm.run(sql`UPDATE material_versions SET status='published',published_at=2 WHERE id=${id}`);
}

testStable(
  'materials enforce kind and version identity while note selection crosses collections',
  (t) => {
    const db = fixture(t);

    diagram(db, 1n);
    db.exec('INSERT INTO note_materials(note_id,material_id,position) VALUES(1,1,0)');
    assert.throws(() =>
      db.exec("INSERT INTO materials(kind,title,created_at,updated_at) VALUES('mystery','No',1,1)")
    );
    db.exec('INSERT INTO note_materials(note_id,material_id,position) VALUES(2,1,0)');
    assert.throws(() =>
      db.exec(
        "INSERT INTO material_versions(material_id,kind,number,created_at) VALUES(1,'quiz',2,1)"
      )
    );
    assert.throws(() =>
      db.exec(
        "INSERT INTO material_versions(material_id,kind,number,created_at) VALUES(999,'diagram',2,1)"
      )
    );
    assert.strictEqual(
      db.orm.get(sql`SELECT 1 FROM sqlite_schema WHERE name='material_file_versions'`),
      undefined
    );
    assert.strictEqual(
      db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM material_versions`)?.n,
      1n
    );
  }
);

testStable(
  'publication rejects absent or incomplete payloads and freezes content and identities',
  (t) => {
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
        "INSERT OR REPLACE INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'diagram',1,1)"
      )
    );
    assert.throws(() => db.exec("UPDATE materials SET kind='file' WHERE id=1"));
    assert.throws(() => db.exec('DELETE FROM material_versions WHERE id=1'));
    assert.throws(() =>
      db.exec(
        "INSERT INTO material_versions(material_id,kind,number,status,created_at,published_at) VALUES(1,'diagram',2,'published',1,2)"
      )
    );
  }
);

testStable(
  'multi-input provenance crosses collections, stays published-only and is sealed at publication',
  (t) => {
    const db = fixture(t);

    diagram(db, 1n);
    publish(db, 1n);
    diagram(db, 3n);
    authored(db, 1n);
    authored(db, 2n);
    db.exec(
      'INSERT INTO material_evidence_inputs(version_id,position,page_version_id) VALUES(3,0,1),(3,1,2)'
    );
    assert.throws(() =>
      db.exec(
        'INSERT INTO material_evidence_inputs(version_id,position,page_version_id) VALUES(1,0,1)'
      )
    );
    authored(db, 4n, false);
    assert.throws(() =>
      db.exec(
        'INSERT INTO material_evidence_inputs(version_id,position,page_version_id) VALUES(3,2,4)'
      )
    );
    authored(db, 5n);
    db.exec(
      'INSERT INTO material_evidence_inputs(version_id,position,page_version_id) VALUES(3,2,5)'
    );
    publish(db, 3n);
    assert.strictEqual(
      db.orm.get(sql`SELECT count(*) n FROM material_evidence_inputs WHERE version_id=3`)?.n,
      3n
    );
    assert.throws(() => db.exec('DELETE FROM material_evidence_inputs WHERE version_id=3'));
    assert.throws(() =>
      db.exec('UPDATE material_evidence_inputs SET version_id=1 WHERE version_id=3')
    );
    db.exec('DELETE FROM projects WHERE id=1');
    assert.strictEqual(db.orm.get(sql`SELECT count(*) n FROM page_versions`)?.n, 4n);
    expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
  }
);

testStable(
  'revision history supports branching within one material and preserves exact versions',
  (t) => {
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
    assert.strictEqual(
      db.orm.get<{ payload: string }>(
        sql`SELECT payload FROM material_diagram_versions WHERE version_id=1`
      )?.payload,
      'graph TD; A-->B'
    );
  }
);

testStable(
  'source originals own media bytes independently of learning and authored storage',
  (t) => {
    const db = fixture(t);

    original(db);
    assert.strictEqual(db.orm.get(sql`SELECT count(*) n FROM source_snapshots`)?.n, 2n);
    assert.strictEqual(db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
    expect(
      db.orm.get(sql`SELECT bytes FROM source_snapshots WHERE source_id=1`)?.bytes
    ).toStrictEqual(new Uint8Array([0, 1, 2, 3]));
    assert.throws(() =>
      db.exec(
        "INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(1,0,X'01','audio','audio/wav')"
      )
    );
    expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
  }
);

testStable('authored versions own canonical snapshots and freeze their underlying blocks', (t) => {
  const db = fixture(t);

  authored(db, 1n, false);
  db.exec('DELETE FROM blocks WHERE document_id=1');
  assert.throws(() =>
    db.exec("UPDATE page_versions SET status='published',published_at=2 WHERE id=1")
  );
  db.exec(`INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(1,0,'paragraph','block-1','{"type":"paragraph","inlines":[{"type":"text","text":"Derivative","marks":[]}]}','Derivative','{"type":"authored"}');
 UPDATE page_versions SET status='published',published_at=2 WHERE id=1;`);

  for (const q of [
    "UPDATE blocks SET text='changed' WHERE document_id=1",
    'DELETE FROM blocks WHERE document_id=1',
    "UPDATE content_snapshots SET meta='{}' WHERE id=1",
    `INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(1,1,'paragraph','extra','{"type":"paragraph","inlines":[]}', '', '{"type":"authored"}')`
  ])
    assert.throws(() => db.exec(q));
});

testStable(
  'collection deletion preserves source bytes, authored versions, learning and independent note attachments',
  (t) => {
    const db = fixture(t);

    original(db);
    authored(db, 1n);
    diagram(db, 1n);
    publish(db, 1n);
    db.exec(`INSERT INTO project_pages(project_id,page_id) VALUES(1,1);
 INSERT INTO note_sources(note_id,source_id,position) VALUES(1,1,0);
 INSERT INTO note_pages(note_id,page_id,position) VALUES(1,1,0);
 INSERT INTO note_materials(note_id,material_id,position) VALUES(1,1,0);
 DELETE FROM projects WHERE id=1;`);

    for (const table of ['sources', 'source_snapshots'])
      assert.strictEqual(db.orm.get(sql.raw(`SELECT count(*) n FROM ${table}`))?.n, 2n);

    for (const table of [
      'content_snapshots',
      'page_versions',
      'material_versions',
      'note_sources',
      'note_pages',
      'note_materials'
    ])
      assert.strictEqual(db.orm.get(sql.raw(`SELECT count(*) n FROM ${table}`))?.n, 1n);

    expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
  }
);

testStable('correct quiz answers roundtrip through the ORM boolean codec', (t) => {
  const db = fixture(t);

  draft(db, 1n, 'quiz');
  db.exec('INSERT INTO material_quiz_versions(version_id) VALUES(1)');
  db.exec(
    "INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES(1,1,0,'single_choice','Q','E')"
  );
  db.exec(
    "INSERT INTO material_quiz_choices(id,question_id,question_kind,position,text,is_correct) VALUES(1,1,'single_choice',0,'yes',1),(2,1,'single_choice',1,'no',0)"
  );
  expect(
    db.orm
      .select()
      .from(material_quiz_choices)
      .orderBy(material_quiz_choices.id)
      .all()
      .map((c) => c.is_correct)
  ).toStrictEqual([true, false]);
});

testStable(
  'draft learning inputs reference exact source extractions independently of collection organization',
  (t) => {
    const db = fixture(t);

    original(db);
    diagram(db, 1n);
    db.exec(`INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(1,2,1,'{}',1);
 INSERT INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(2,1,1);
 INSERT INTO material_evidence_inputs(version_id,position,source_id,source_revision,source_snapshot_id) VALUES(1,0,2,1,1);
 UPDATE sources SET project_id=2 WHERE id=1;`);
    assert.strictEqual(
      db.orm.get(sql`SELECT source_id FROM material_evidence_inputs`)?.source_id,
      2n
    );
  }
);

testStable('authored publication rejects malformed canonical anchors', (t) => {
  const db = fixture(t);

  authored(db, 1n, false);

  for (const anchor of ['null', '{}', '[]', '{"type":"page","page":0}']) {
    db.orm.run(sql`UPDATE blocks SET anchor=${anchor} WHERE document_id=1`);
    assert.throws(() =>
      db.exec("UPDATE page_versions SET status='published',published_at=2 WHERE id=1")
    );
  }

  db.exec(`UPDATE blocks SET anchor='{"type":"authored"}' WHERE document_id=1;
    UPDATE page_versions SET status='published',published_at=2 WHERE id=1`);
});

testStable('scheduling fields declared bigint reject fractional storage', (t) => {
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

testStable(
  'removing a draft learning artifact preserves a source-owned extraction snapshot',
  (t) => {
    const db = fixture(t);

    original(db);
    diagram(db, 1n);
    db.exec(`INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(1,1,1,'{}',1);
 INSERT INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(1,1,1);
 INSERT INTO material_evidence_inputs(version_id,position,source_id,source_revision,source_snapshot_id) VALUES(1,0,1,1,1);
 DELETE FROM material_versions WHERE id=1;`);
    assert.strictEqual(db.orm.get(sql`SELECT count(*) n FROM content_snapshots`)?.n, 1n);
    assert.strictEqual(db.orm.get(sql`SELECT count(*) n FROM source_extraction_revisions`)?.n, 1n);
  }
);

testStable(
  'retired source and document Material kinds cannot be authored through generic storage',
  (t) => {
    const db = fixture(t);

    for (const kind of ['file', 'audio', 'video', 'image', 'link', 'document'])
      assert.throws(() => draft(db, 1n, kind));

    diagram(db, 1n);
    assert.throws(() =>
      db.exec(
        'INSERT INTO material_evidence_inputs(version_id,position,source_id,source_revision,source_snapshot_id) VALUES(1,0,999,1,999)'
      )
    );
  }
);

testStable('material citations enforce positive unsigned 32 bit markers', (t) => {
  const db = fixture(t);

  authored(db, 1n);
  diagram(db, 2n);
  db.exec(
    'INSERT INTO material_evidence_inputs(id,version_id,position,page_version_id) VALUES(1,2,0,1)'
  );
  const insert = (marker: bigint) =>
    db.orm.run(
      sql`INSERT INTO material_evidence_citations(version_id,marker,input_id,anchor,quote) VALUES(2,${marker},1,'{"type":"authored"}','Quote')`
    );

  for (const marker of [0n, -1n, 4294967296n]) assert.throws(() => insert(marker));

  for (const marker of [1n, 4294967295n]) insert(marker);

  assert.strictEqual(
    db.orm.get<{ n: bigint }>(sql`SELECT count(*) AS n FROM material_evidence_citations`)?.n,
    2n
  );
  assert.throws(() => insert(1n));
});

testStable('fresh canonical migrations preserve all published citation mutation guards', (t) => {
  const db = fixture(t);

  authored(db, 1n);
  diagram(db, 2n);
  db.exec(`
    INSERT INTO material_evidence_inputs(id,version_id,position,page_version_id) VALUES(1,2,0,1);
    INSERT INTO material_evidence_citations(version_id,marker,input_id,anchor,quote)
      VALUES(2,1,1,'{"type":"authored"}','Original quote');
  `);
  publish(db, 2n);

  for (const statement of [
    sql`INSERT INTO material_evidence_citations(version_id,marker,input_id,anchor,quote)
      VALUES(2,2,1,'{"type":"authored"}','Added quote')`,
    sql`UPDATE material_evidence_citations SET quote='Changed quote' WHERE version_id=2`,
    sql`DELETE FROM material_evidence_citations WHERE version_id=2`
  ])
    assert.throws(() => db.orm.run(statement));

  expect(
    db.orm.all(sql`SELECT marker,anchor,quote FROM material_evidence_citations WHERE version_id=2`)
  ).toStrictEqual([{ marker: 1n, anchor: '{"type":"authored"}', quote: 'Original quote' }]);
  expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
});

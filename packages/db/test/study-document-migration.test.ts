import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { annotationSchema, assessmentSchema } from '@study/contracts/documents/evidence';
import { testMigration } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/index.ts';
import { assertFinalStorage } from './final-storage.ts';

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

const rich = JSON.stringify({
  type: 'paragraph',
  inlines: [{ type: 'text', text: 'Retained 😀', marks: ['strong'] }]
});

function cell(db: Db, query: SQL, key: string): unknown {
  const row = db.orm.get(query);

  assert.ok(row);

  return row[key];
}

testMigration({ migration: 'document_domains_cutover', retention: 'permanent' })(
  'authored cutover migrates exact content, all retained versions, conflicts, archive, evidence and independent memberships',
  async () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-authored-migration-'));
    const previous = join(folder, 'migrations');

    mkdirSync(previous);
    const migrations =
      process.env.STUDY_FINAL_MIGRATIONS ?? fileURLToPath(new URL('../drizzle', import.meta.url));
    let db: Db | undefined;

    try {
      for (const name of readdirSync(migrations))
        if (name <= '20261103204411_icy_lenny_balinger')
          cpSync(join(migrations, name), join(previous, name), { recursive: true });

      const path = join(folder, 'study.db');

      db = Db.open(path, previous);
      db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(5,'Project',1,1);
   INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(9,'Session','user',1,1);
   INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(7,'attachment','text','text/plain','Source',1,zeroblob(32),1);
   INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(7,3,X'41','text','text/plain');
   INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(70,7,0,'${meta}',1);
   INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(70,0,'paragraph','source-block','${rich}','Retained 😀','{"type":"page","page":2}');
   INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(8,'attachment','image','image/png','Image',1,zeroblob(32),1);
   INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(8,1,X'41','image','image/png');
   INSERT INTO source_processing(source_id,revision,request_id,published_request_id,document_id) VALUES(7,3,'source-3','source-3',70);
   INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(7,'file','Source',1,1),(10,'document','Authored',1,1),(20,'document','Archived',1,1);
   INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(70,7,'file',1,1);
   INSERT INTO material_file_versions(version_id,source_id) VALUES(70,7);
   INSERT INTO material_source_snapshots(version_id,source_id,revision,document_id,metadata) VALUES(70,7,3,NULL,json_object('id','7','projectId',NULL,'projectName',NULL,'name','Source','kind','text','mime','text/plain','origin','attachment','sizeBytes','1','sha256',lower(hex(zeroblob(32))),'uri',NULL,'createdAt','1'));
   UPDATE material_versions SET creator='import' WHERE id=70;
   UPDATE material_versions SET status='published',published_at=2 WHERE id=70;
   INSERT INTO material_imports(source_id,material_id) VALUES(7,7);
   INSERT INTO material_versions(id,material_id,kind,number,creator,operation,created_at) VALUES(71,7,'file',2,'import','extract',2);
   INSERT INTO material_file_versions(version_id,source_id) VALUES(71,7);
   INSERT INTO material_source_snapshots(version_id,source_id,revision,document_id,metadata) VALUES(71,7,3,70,json_object('id','7','projectId',NULL,'projectName',NULL,'name','Source','kind','text','mime','text/plain','origin','attachment','sizeBytes','1','sha256',lower(hex(zeroblob(32))),'uri',NULL,'createdAt','1'));
   UPDATE material_versions SET status='published',published_at=3 WHERE id=71;
   INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(101,10,'document',1,1),(102,10,'document',2,2),(103,10,'document',3,3),(201,20,'document',1,1);
   INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(101,0,'${meta}',1),(102,0,'${meta}',2),(103,0,'${meta}',3),(201,0,'${meta}',1);
   INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
    SELECT id,0,'paragraph','authored-'||id,'${rich}','Retained 😀','{"type":"authored"}' FROM content_snapshots WHERE id IN(101,102,103,201);
   INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(101,1,'image','authored-image','{"type":"image","sourceId":"8","revision":1,"alt":""}','','{"type":"authored"}');
   INSERT INTO material_document_versions(version_id,document_id) VALUES(101,101),(102,102),(103,103),(201,201);
   INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(101,71),(102,71),(103,71);
   INSERT INTO material_version_citations(version_id,marker,input_version_id,anchor,target,quote) VALUES(101,1,71,'{"type":"page","page":2}','{"versionId":"71","documentId":"70","blockId":"source-block","start":0,"end":11}','Retained 😀');
   UPDATE material_versions SET status='published',published_at=2 WHERE id=101;
   INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(201,101);
   UPDATE material_versions SET status='published',published_at=2 WHERE id=201;
   INSERT INTO material_version_parents(version_id,parent_version_id,material_id) VALUES(102,101,10),(103,101,10);
   UPDATE material_versions SET status='published',published_at=3 WHERE id=102;
   INSERT INTO document_edit_receipts(material_id,key,operation,intent,expected_version_id,current_version_id,submitted_version_id,outcome) VALUES(10,'saved','save','{"exact":"saved"}',101,101,102,'saved'),(10,'conflict','save','{"exact":"conflict"}',101,102,103,'conflict');
   INSERT INTO project_materials(project_id,material_id) VALUES(5,10),(5,20),(5,7);
   INSERT INTO session_materials(session_id,material_id,position) VALUES(9,7,0),(9,10,1),(9,20,2);
   INSERT INTO material_annotations(id,material_id,revision) VALUES(31,10,1);
   INSERT INTO material_annotation_revisions(annotation_id,revision,version_id,document_id,payload) VALUES(31,1,101,101,'{"id":"31","revision":"1","target":{"materialId":"10","range":{"versionId":"101","documentId":"101","blockId":"authored-101","start":0,"end":11}},"kind":"note","note":"Exact annotation 😀","deleted":false,"operation":"create"}');
   INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(90,'Proposal session','user',1,1);
   INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot) VALUES('proposal-context',90,'context','{}','{"requestId":"proposal-context","sessionId":"90","inputs":[]}');
   INSERT INTO material_generation_requests(id,payload,created_at) VALUES('document/proposal-context','{"kind":"document","inputVersionIds":[],"documentTransform":{"contextRequestId":"proposal-context"}}',1);
   INSERT INTO document_proposals(request_id,session_id,base_version_id,proposed_version_id) VALUES('document/proposal-context',90,101,103);
   INSERT INTO document_proposal_receipts(key,request_id,operation,intent,outcome,current_version_id) VALUES('proposal-conflict','document/proposal-context','apply','{}','conflict',102);
   INSERT INTO material_citation_assessments(claim_version_id,evidence_version_id,marker,payload) VALUES(101,71,1,'{"claim":{"materialId":"10","range":{"versionId":"101","documentId":"101","blockId":"authored-101","start":0,"end":11}},"evidence":{"materialId":"7","range":{"versionId":"71","documentId":"70","blockId":"source-block","start":0,"end":11}},"marker":"1","judgment":"supports","note":"Exact judgment","suppliedBy":"user","independentVerification":false,"citation":{"anchor":{"type":"page","page":2},"quote":"Retained 😀","target":{"versionId":"71","documentId":"70","blockId":"source-block","start":0,"end":11}}}');
   INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(7,4,X'42','text','text/plain');
   UPDATE source_processing SET revision=4,request_id='pending-source-4' WHERE source_id=7;
   INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(30,'diagram','Learning',1,1);
   INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(301,30,'diagram',1,1);
   INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(301,'mermaid','graph TD; A-->B');
   INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(301,101),(301,71);
   INSERT INTO material_version_citations(version_id,marker,input_version_id,anchor,target,quote) VALUES(301,1,71,'{"type":"page","page":2}','{"versionId":"71","documentId":"70","blockId":"source-block","start":0,"end":11}','Retained 😀');
   UPDATE material_versions SET status='published',published_at=4 WHERE id=301;
   UPDATE materials SET archived_at=4,updated_at=4 WHERE id=20;`);
      const oldBlocks = db.orm.all(
        sql`SELECT document_id,ordinal,editing_id,content,text,anchor FROM blocks ORDER BY document_id,ordinal`
      );
      const oldReceipts = db.orm.all(
        sql`SELECT key,intent,outcome FROM document_edit_receipts ORDER BY key`
      );

      db.close();
      db = undefined;
      db = Db.open(path, migrations);
      assertFinalStorage(db);
      const mappings = [
        { old_snapshot_id: 101n, new_snapshot_id: 202n },
        { old_snapshot_id: 102n, new_snapshot_id: 203n },
        { old_snapshot_id: 103n, new_snapshot_id: 204n },
        { old_snapshot_id: 201n, new_snapshot_id: 205n }
      ];

      assert.strictEqual(cell(db, sql`SELECT count(*) AS n FROM study_document_versions`, 'n'), 4n);
      expect(
        db.orm
          .all(sql`SELECT id,status,number FROM study_document_versions ORDER BY id`)
          .map((x) => ({ ...x }))
      ).toStrictEqual([
        { id: 1n, status: 'published', number: 1n },
        { id: 2n, status: 'published', number: 2n },
        { id: 3n, status: 'draft', number: 3n },
        { id: 4n, status: 'published', number: 1n }
      ]);

      for (const map of mappings) {
        const old = oldBlocks
          .filter((x) => x.document_id === map.old_snapshot_id)
          .map(({ document_id: _documentId, ...x }) => ({ ...x }));
        const current: Record<string, unknown>[] = db.orm
          .all(
            sql`SELECT ordinal,editing_id,content,text,anchor FROM blocks WHERE document_id=${map.new_snapshot_id} ORDER BY ordinal`
          )
          .map((x) => ({ ...x }));

        expect(current).toStrictEqual(old);
        assert.strictEqual(
          cell(db, sql`SELECT meta FROM content_snapshots WHERE id=${map.new_snapshot_id}`, 'meta'),
          meta
        );
      }

      expect(
        db.orm.all(sql`SELECT key,intent,outcome FROM study_document_edit_receipts ORDER BY key`)
      ).toStrictEqual(oldReceipts.map((receipt) => ({ ...receipt, intent: '"domain_cutover"' })));
      expect({
        ...db.orm.get(
          sql`SELECT expected_version_id,current_version_id,submitted_version_id,outcome FROM study_document_edit_receipts WHERE key='conflict'`
        )
      }).toStrictEqual({
        expected_version_id: 1n,
        current_version_id: 2n,
        submitted_version_id: 3n,
        outcome: 'conflict'
      });
      assert.strictEqual(
        cell(db, sql`SELECT archived_at FROM study_documents WHERE id=2`, 'archived_at'),
        4n
      );
      assert.strictEqual(
        db.orm.get(
          sql`SELECT snapshot_id FROM source_extraction_revisions WHERE source_id=7 AND revision=4`
        ),
        undefined,
        'a previous extraction must not be attributed to an unfinished replacement revision'
      );
      expect({
        ...db.orm.get(
          sql`SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE version_id=1`
        )
      }).toStrictEqual({ source_id: 7n, source_revision: 3n, source_snapshot_id: 70n });
      assert.strictEqual(
        cell(
          db,
          sql`SELECT document_version_id FROM study_document_inputs WHERE version_id=4`,
          'document_version_id'
        ),
        1n
      );
      const citation = db.orm.get(
        sql`SELECT anchor,target,quote FROM study_document_citations WHERE version_id=1`
      );

      expect({ ...citation }).toStrictEqual({
        anchor: '{"type":"page","page":2}',
        target: '{"blockId":"source-block","start":0,"end":11}',
        quote: 'Retained 😀'
      });
      const annotation = JSON.parse(
        String(cell(db, sql`SELECT payload FROM study_document_annotation_revisions`, 'payload'))
      );

      assert.strictEqual(annotation.note, 'Exact annotation 😀');
      expect(annotation.target).toStrictEqual({
        documentId: '1',
        range: { versionId: '1', snapshotId: '202', blockId: 'authored-101', start: 0, end: 11 }
      });
      assert.strictEqual(cell(db, sql`SELECT count(*) AS n FROM project_documents`, 'n'), 2n);
      assert.strictEqual(
        cell(db, sql`SELECT source_id FROM document_assets WHERE document_id=202`, 'source_id'),
        8n
      );
      expect({
        ...db.orm.get(
          sql`SELECT base_version_id,proposed_version_id FROM study_document_proposals WHERE request_id='document/proposal-context'`
        )
      }).toStrictEqual({ base_version_id: 1n, proposed_version_id: 3n });
      assert.strictEqual(
        cell(
          db,
          sql`SELECT current_version_id FROM study_document_proposal_receipts WHERE key='proposal-conflict'`,
          'current_version_id'
        ),
        2n
      );
      assert.strictEqual(
        cell(
          db,
          sql`SELECT id FROM study_document_generation_requests WHERE id='document/proposal-context'`,
          'id'
        ),
        'document/proposal-context'
      );
      const assessment = JSON.parse(
        String(cell(db, sql`SELECT payload FROM study_document_citation_assessments`, 'payload'))
      );

      assert.strictEqual(assessment.note, 'Exact judgment');
      expect(assessment.evidence).toStrictEqual({
        kind: 'source',
        sourceId: '7',
        revision: '3',
        snapshotId: '70'
      });
      assert.strictEqual(assessment.claim.range.versionId, '1');
      const decodedAssessment = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.toCodecJson(assessmentSchema))
      )(JSON.stringify(assessment));

      assert.strictEqual(decodedAssessment.claim.range.versionId, 1n);
      const decodedAnnotation = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.toCodecJson(annotationSchema))
      )(JSON.stringify(annotation));

      assert.strictEqual(decodedAnnotation.target.range.snapshotId, 202n);
      assert.strictEqual(cell(db, sql`SELECT count(*) AS n FROM session_documents`, 'n'), 2n);
      assert.strictEqual(cell(db, sql`SELECT source_id FROM session_sources`, 'source_id'), 7n);
      assert.strictEqual(
        cell(db, sql`SELECT source_id FROM content_snapshots WHERE id=70`, 'source_id'),
        7n
      );
      assert.strictEqual(cell(db, sql`SELECT count(*) AS n FROM materials`, 'n'), 1n);
      assert.strictEqual(cell(db, sql`SELECT count(*) AS n FROM source_snapshots`, 'n'), 3n);
      expect(
        db.orm
          .all(
            sql`SELECT document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=301 ORDER BY position`
          )
          .map((x) => ({ ...x }))
      ).toStrictEqual([
        {
          document_version_id: null,
          source_id: 7n,
          source_revision: 3n,
          source_snapshot_id: 70n
        },
        {
          document_version_id: 1n,
          source_id: null,
          source_revision: null,
          source_snapshot_id: null
        }
      ]);
      const learningCitation = db.orm.get(
        sql`SELECT marker,anchor,target,quote FROM material_evidence_citations WHERE version_id=301`
      )!;

      assert.strictEqual(learningCitation.marker, 1n);
      assert.strictEqual(learningCitation.quote, 'Retained 😀');
      expect(JSON.parse(String(learningCitation.target))).toStrictEqual({
        blockId: 'source-block',
        start: 0,
        end: 11
      });
      assert.throws(() => db!.exec('DELETE FROM material_evidence_inputs WHERE version_id=301'));
      assert.throws(() =>
        db!.exec("UPDATE material_evidence_citations SET quote='Forged' WHERE version_id=301")
      );

      assert.throws(() => db!.exec(`UPDATE blocks SET text='Changed' WHERE document_id=202`));
      assert.throws(() => db!.exec(`UPDATE study_document_citations SET quote='Changed'`));
      db.exec('DELETE FROM sessions WHERE id=9;DELETE FROM projects WHERE id=5;');
      assert.strictEqual(cell(db, sql`SELECT count(*) AS n FROM study_document_versions`, 'n'), 4n);
      assert.strictEqual(cell(db, sql`SELECT count(*) AS n FROM study_documents`, 'n'), 2n);
      expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      assert.strictEqual(cell(db, sql`PRAGMA integrity_check`, 'integrity_check'), 'ok');
      const backup = join(folder, 'backup.db');
      const identity = db.contentIdentity();

      await db.snapshot(backup);
      // An unpublished staged schema must remain outside the runtime's trusted restore set.

      if (process.env.STUDY_FINAL_MIGRATIONS)
        assert.throws(() => Db.validateSnapshot(backup), TypeError);
      else assert.strictEqual(Db.validateSnapshot(backup), db.schemaIdentity());

      const restored = process.env.STUDY_FINAL_MIGRATIONS
        ? Db.open(backup, migrations)
        : Db.openSnapshot(backup);

      try {
        assert.strictEqual(restored.contentIdentity(), identity);
        expect(restored.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        restored.close();
      }
    } finally {
      db?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);

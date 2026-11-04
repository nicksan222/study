import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { testMigration } from '@study/testing/node';
import { sql } from 'drizzle-orm';
import { Schema } from 'effect';

import { Db } from '../src/index.ts';
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

const paragraph = (text: string) =>
  JSON.stringify({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });

const snapshot = (
  id: number,
  text: string,
  block = 'base-block'
) => `INSERT INTO content_snapshots(id,extractor_version,meta,created_at) VALUES(${id},0,'${meta}',1);
INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(${id},0,'paragraph','${block}','${paragraph(text)}','${text}','{"type":"authored"}');`;

const oldAnnotation = (revision: number, versionId: number, snapshotId: number, note: string) =>
  JSON.stringify({
    id: '31',
    revision: String(revision),
    target: {
      materialId: '1',
      range: {
        versionId: String(versionId),
        documentId: String(snapshotId),
        blockId: 'base-block',
        start: 0,
        end: 4
      }
    },
    kind: 'note',
    note,
    deleted: false,
    operation: revision === 1 ? 'create' : 'update'
  });

testMigration({ migration: 'document_domains_cutover', retention: 'permanent' })(
  'late authored delta preserves native heads and divergent annotation histories while migrating new owners, evidence, memberships and receipts',
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-authored-delta-'));
    const official = fileURLToPath(new URL('../drizzle', import.meta.url));
    const migrations = process.env.STUDY_DELTA_MIGRATIONS ?? official;
    const before = join(folder, 'before');
    const copied = join(folder, 'copied');

    mkdirSync(before);
    mkdirSync(copied);
    let db: Db | undefined;

    try {
      for (const name of readdirSync(official)) {
        if (name < '20261104010712')
          cpSync(join(official, name), join(copied, name), { recursive: true });

        if (name <= '20261103204411_icy_lenny_balinger')
          cpSync(join(official, name), join(before, name), { recursive: true });
      }

      const path = join(folder, 'study.db');

      db = Db.open(path, before);
      db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(5,'Project',1,1);
   INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(9,'Session','user',1,1);
   INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'document','Original',1,1);
   INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(11,1,'document',1,1);
   ${snapshot(11, 'Base')}
   INSERT INTO material_document_versions(version_id,document_id) VALUES(11,11);
   UPDATE material_versions SET status='published',published_at=1 WHERE id=11;
   INSERT INTO material_annotations(id,material_id,revision) VALUES(31,1,1);
   INSERT INTO material_annotation_revisions(annotation_id,revision,version_id,document_id,payload) VALUES(31,1,11,11,'${oldAnnotation(1, 11, 11, 'Original note')}');`);
      db.close();
      db = undefined;
      db = Db.open(path, copied);
      db.exec(`${snapshot(30, 'Native')}
   INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at) VALUES(2,1,2,30,2);
   INSERT INTO study_document_version_parents(version_id,parent_version_id,document_id) VALUES(2,1,1);
   UPDATE study_document_versions SET status='published',published_at=2 WHERE id=2;
   INSERT INTO study_document_annotation_revisions(annotation_id,revision,document_id,version_id,snapshot_id,payload)
    VALUES(1,2,1,2,30,'{"id":"1","revision":"2","target":{"documentId":"1","range":{"versionId":"2","snapshotId":"30","blockId":"base-block","start":0,"end":4}},"kind":"note","note":"Native note","deleted":false,"operation":"update"}');
   UPDATE study_document_annotations SET revision=2 WHERE id=1;
   ${snapshot(20, 'Legacy late')}
   INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(12,1,'document',2,2);
   INSERT INTO material_document_versions(version_id,document_id) VALUES(12,20);
   INSERT INTO material_version_parents(version_id,parent_version_id,material_id) VALUES(12,11,1);
   UPDATE material_versions SET status='published',published_at=2 WHERE id=12;
   INSERT INTO material_annotation_revisions(annotation_id,revision,version_id,document_id,payload) VALUES(31,2,12,20,'${oldAnnotation(2, 12, 20, 'Legacy note')}');
   UPDATE material_annotations SET revision=2 WHERE id=31;
   INSERT INTO document_edit_receipts(material_id,key,operation,intent,expected_version_id,current_version_id,submitted_version_id,outcome) VALUES(1,'late-save','save','{"body":"private legacy intent"}',11,11,12,'saved');
   INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(2,'document','Late owner',2,2),(3,'diagram','Late learning',2,2);
   ${snapshot(21, 'Late owner', 'late-block')}
   INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(21,2,'document',1,2),(31,3,'diagram',1,2);
   INSERT INTO material_document_versions(version_id,document_id) VALUES(21,21);
   INSERT INTO material_version_inputs(version_id,input_version_id) VALUES(21,12),(31,12);
   INSERT INTO material_version_citations(version_id,marker,input_version_id,anchor,target,quote) VALUES(21,1,12,'{"type":"authored"}','{"versionId":"12","documentId":"20","blockId":"base-block","start":0,"end":6}','Legacy'),(31,1,12,'{"type":"authored"}','{"versionId":"12","documentId":"20","blockId":"base-block","start":0,"end":6}','Legacy');
   INSERT INTO material_diagram_versions(version_id,format,payload) VALUES(31,'mermaid','graph TD; A-->B');
   UPDATE material_versions SET status='published',published_at=2 WHERE id IN(21,31);
   INSERT INTO project_materials(project_id,material_id) VALUES(5,2);
   INSERT INTO session_materials(session_id,material_id,position) VALUES(9,2,0);`);
      const context = {
        requestId: 'late-context',
        sessionId: '9',
        intentKey: 'late-key',
        instruction: 'Explain',
        preferences: {},
        selectionRevision: '0',
        inputs: [
          {
            materialId: '1',
            versionId: '12',
            documentId: '20',
            name: 'Legacy late',
            scope: {
              kind: 'ranges',
              ranges: [
                { versionId: '12', documentId: '20', blockId: 'base-block', start: 0, end: 6 }
              ]
            },
            excerpts: [
              {
                blockId: 'base-block',
                blockOrdinal: 0,
                start: 0,
                end: 6,
                text: 'Legacy',
                anchor: { type: 'authored' }
              }
            ]
          }
        ],
        messages: [],
        excludedMessages: 0
      };

      db.exec(`UPDATE sessions SET selection='[{"materialId":"1","versionId":"12","scope":{"kind":"document"}}]' WHERE id=9;
      INSERT INTO session_run_contexts(request_id,session_id,intent_key,intent,snapshot) VALUES('late-context',9,'late-key','{}','${JSON.stringify(context)}');
      INSERT INTO messages(id,session_id,role,created_at) VALUES(1,9,'user',1);
      INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(1,1,1,'typed','complete','Ask',1);
      INSERT INTO citations(version_id,marker,material_version_id,document_id,block_id,range_start,range_end,source_name,anchor,quote) VALUES(1,1,12,20,'base-block',0,6,'Legacy late','{"type":"authored"}','Legacy');`);
      db.close();
      db = undefined;
      db = Db.open(path, migrations);
      const versions = db.orm
        .all(
          sql`SELECT v.id,v.number,b.text FROM study_document_versions v JOIN blocks b ON b.document_id=v.content_snapshot_id WHERE v.document_id=1 ORDER BY v.number`
        )
        .map((row) => ({ ...row }));

      assert.deepEqual(versions, [
        { id: 1n, number: 1n, text: 'Base' },
        { id: 3n, number: 2n, text: 'Legacy late' },
        { id: 2n, number: 3n, text: 'Native' }
      ]);
      assert.equal(
        requireRow(db.orm.get(sql`SELECT document_id FROM session_documents WHERE session_id=9`))
          .document_id,
        2n
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT document_id FROM project_documents WHERE project_id=5`))
          .document_id,
        2n
      );
      assert.equal(
        requireRow(
          db.orm.get(sql`SELECT document_version_id FROM study_document_inputs WHERE version_id=4`)
        ).document_version_id,
        3n
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT quote FROM study_document_citations WHERE version_id=4`))
          .quote,
        'Legacy'
      );
      assert.equal(
        requireRow(
          db.orm.get(
            sql`SELECT document_version_id FROM material_evidence_inputs WHERE version_id=31`
          )
        ).document_version_id,
        3n
      );
      assert.equal(
        requireRow(
          db.orm.get(sql`SELECT quote FROM material_evidence_citations WHERE version_id=31`)
        ).quote,
        'Legacy'
      );
      assert.equal(
        requireRow(
          db.orm.get(
            sql`SELECT payload FROM study_document_annotation_revisions WHERE annotation_id=1 AND revision=2`
          )
        )
          .payload?.toString()
          .includes('Native note'),
        true
      );
      assert.equal(
        requireRow(
          db.orm.get(
            sql`SELECT payload FROM study_document_annotation_revisions WHERE annotation_id=2 AND revision=2`
          )
        )
          .payload?.toString()
          .includes('Legacy note'),
        true
      );
      assert.equal(
        requireRow(
          db.orm.get(sql`SELECT intent FROM study_document_edit_receipts WHERE key='late-save'`)
        ).intent,
        '"domain_cutover"'
      );
      const captured = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema))
      )(
        String(
          requireRow(
            db.orm.get(
              sql`SELECT snapshot FROM session_run_contexts WHERE request_id='late-context'`
            )
          ).snapshot
        )
      );

      assert.deepEqual(captured.inputs[0]!.input, { kind: 'document', versionId: 3n });
      assert.equal(captured.inputs[0]!.documentId, 1n);
      assert.equal(
        requireRow(
          db.orm.get(
            sql`SELECT version_id FROM session_context_documents WHERE request_id='late-context'`
          )
        ).version_id,
        3n
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT authored_version_id FROM citations WHERE version_id=1`))
          .authored_version_id,
        3n
      );
      assert.equal(
        requireRow(db.orm.get(sql`SELECT document_id FROM citations WHERE version_id=1`))
          .document_id,
        captured.inputs[0]!.snapshotId
      );
      assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
      const identity = db.schemaIdentity();

      db.close();
      db = undefined;
      db = Db.open(path, migrations);
      assert.equal(db.schemaIdentity(), identity);
      assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      db?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);

testMigration({ migration: 'document_domains_cutover', retention: 'permanent' })(
  'complete late delta initializes a fresh SQLite database with restored publication guards',
  () => {
    const migrations =
      process.env.STUDY_DELTA_MIGRATIONS ?? fileURLToPath(new URL('../drizzle', import.meta.url));
    const db = Db.open(':memory:', migrations);

    try {
      assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
      assert.ok(
        db.orm.get(
          sql`SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='study_document_versions_sealed_update'`
        )
      );
      assert.ok(
        db.orm.get(
          sql`SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='study_document_retirement_dependencies'`
        )
      );
    } finally {
      db.close();
    }
  }
);

import assert from 'node:assert/strict';

import { sql } from 'drizzle-orm';

import type { Db } from '../src/index.ts';

const superseded = [
  'material_document_versions',
  'material_file_versions',
  'material_audio_versions',
  'material_video_versions',
  'material_image_versions',
  'material_link_versions',
  'material_imports',
  'material_source_snapshots',
  'material_version_inputs',
  'material_generation_inputs',
  'material_version_citations',
  'material_annotations',
  'material_annotation_revisions',
  'material_citation_assessments',
  'document_edit_receipts',
  'document_proposals',
  'document_proposal_receipts',
  'retired_document_proposal_receipts',
  'session_generation_retirements',
  'conversation_history_intents',
  'source_history_documents',
  'source_history_revisions',
  'source_material_deletion_assets',
  'legacy_document_materials',
  'legacy_document_versions',
  'legacy_document_generations',
  'legacy_document_annotations',
  'legacy_material_version_id',
  'result_metadata'
];

/** Checks the final persisted model, including trigger bodies and foreign-key definitions. */
export function assertFinalStorage(db: Db) {
  const forbidden = new RegExp(`\\b(${superseded.join('|')})\\b`);

  for (const row of db.orm.all<{ name: string; sql: string }>(
    sql`SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL`
  ))
    assert.equal(forbidden.test(row.sql), false, `${row.name} retains superseded storage`);

  assert.equal(
    db.orm.get(sql`SELECT 1 FROM materials WHERE kind NOT IN('diagram','quiz','flashcards')`),
    undefined
  );
  assert.equal(
    db.orm.get(
      sql`SELECT 1 FROM material_versions WHERE kind NOT IN('diagram','quiz','flashcards') OR creator NOT IN('user','agent') OR operation NOT IN('original','edit','generate')`
    ),
    undefined
  );
  assert.equal(
    db.orm.get(sql`SELECT 1 FROM pragma_table_info('citations') WHERE name='material_version_id'`),
    undefined
  );
  assert.deepEqual(db.orm.all(sql`PRAGMA foreign_key_check`), []);
  assert.equal(db.orm.get(sql`PRAGMA integrity_check`)?.integrity_check, 'ok');
}

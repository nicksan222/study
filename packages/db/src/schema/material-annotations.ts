import type {
  MaterialAnnotationId,
  MaterialId,
  MaterialVersionId,
  DocumentId
} from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, primaryKey, check, index } from 'drizzle-orm/sqlite-core';

import { documents } from './documents.ts';
import { materials, material_versions } from './material-versions.ts';

/** Annotation identity survives explicit deletion; no annotation operation owns content. */
export const material_annotations = sqliteTable(
  'material_annotations',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<MaterialAnnotationId>(),
    material_id: integer()
      .$type<MaterialId>()
      .notNull()
      .references(() => materials.id),
    revision: integer().$type<bigint>().notNull()
  },
  (t) => [
    index('material_annotations_material_idx').on(t.material_id, t.id),
    check('material_annotations_revision_check', sql`${t.revision} >= 1`)
  ]
);

/** Schema-decoded canonical targets, notes and tombstones retain every successful reanchor. */
export const material_annotation_revisions = sqliteTable(
  'material_annotation_revisions',
  {
    annotation_id: integer()
      .$type<MaterialAnnotationId>()
      .notNull()
      .references(() => material_annotations.id),
    revision: integer().$type<bigint>().notNull(),
    version_id: integer()
      .$type<MaterialVersionId>()
      .notNull()
      .references(() => material_versions.id),
    document_id: integer()
      .$type<DocumentId>()
      .notNull()
      .references(() => documents.id),
    payload: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.annotation_id, t.revision] }),
    check(
      'material_annotation_revisions_payload_check',
      sql`json_valid(${t.payload}) AND ${t.revision} >= 1`
    )
  ]
);

/** Append-only user assessments; copying a citation does not copy this row. */
export const material_citation_assessments = sqliteTable(
  'material_citation_assessments',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    claim_version_id: integer()
      .$type<MaterialVersionId>()
      .notNull()
      .references(() => material_versions.id),
    evidence_version_id: integer()
      .$type<MaterialVersionId>()
      .notNull()
      .references(() => material_versions.id),
    marker: integer().$type<bigint>().notNull(),
    payload: text().notNull()
  },
  (t) => [
    index('material_citation_assessments_claim_idx').on(t.claim_version_id, t.marker, t.id),
    check(
      'material_citation_assessments_payload_check',
      sql`json_valid(${t.payload}) AND ${t.marker} BETWEEN 1 AND 4294967295`
    )
  ]
);

import type { ContentSnapshotId, SourceId, StudyDocumentVersionId } from '@study/contracts/ids';

import { sql, check, foreignKey, integer, text, primaryKey } from '../schema-builder.ts';
import type { AnySQLiteColumn } from '../schema-builder.ts';
import { source_extraction_revisions } from './source-processing.ts';
import { study_document_versions } from './study-documents.ts';

/** One normalized exact readable-input shape across durable learning owners. */
export function exactContentInputColumns() {
  return {
    document_version_id: integer()
      .$type<StudyDocumentVersionId>()
      .references(() => study_document_versions.id),
    source_id: integer().$type<SourceId>(),
    source_revision: integer().$type<bigint>(),
    source_snapshot_id: integer().$type<ContentSnapshotId>()
  };
}

export function exactContentInputConstraints(t: {
  document_version_id: AnySQLiteColumn;
  source_id: AnySQLiteColumn;
  source_revision: AnySQLiteColumn;
  source_snapshot_id: AnySQLiteColumn;
}) {
  return [
    foreignKey({
      columns: [t.source_id, t.source_revision, t.source_snapshot_id],
      foreignColumns: [
        source_extraction_revisions.source_id,
        source_extraction_revisions.revision,
        source_extraction_revisions.snapshot_id
      ]
    }),
    check(
      'exact_content_input_reference',
      sql`((${t.document_version_id} IS NOT NULL AND ${t.source_id} IS NULL AND ${t.source_revision} IS NULL AND ${t.source_snapshot_id} IS NULL) OR (${t.document_version_id} IS NULL AND ${t.source_id} IS NOT NULL AND ${t.source_revision}>0 AND ${t.source_snapshot_id} IS NOT NULL))`
    )
  ];
}

/** Citation payload columns shared by exact authored and learning evidence owners. */
export function exactCitationColumns() {
  return {
    marker: integer().$type<bigint>().notNull(),
    input_id: integer().$type<bigint>().notNull(),
    anchor: text().notNull(),
    target: text(),
    quote: text().notNull()
  };
}

/** Composite citation ownership shares the same exact version and input tuple. */
export function exactCitationConstraints(
  t: { version_id: AnySQLiteColumn; marker: AnySQLiteColumn; input_id: AnySQLiteColumn },
  input: { id: AnySQLiteColumn; version_id: AnySQLiteColumn },
  cascade = false
) {
  const owner = foreignKey({
    columns: [t.input_id, t.version_id],
    foreignColumns: [input.id, input.version_id]
  });

  if (cascade) owner.onDelete('cascade');

  return [primaryKey({ columns: [t.version_id, t.marker] }), owner];
}

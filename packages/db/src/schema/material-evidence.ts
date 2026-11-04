/** Learning artifacts consume authored versions and source extractions directly. */
import type { MaterialVersionId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';

import {
  exactCitationColumns,
  exactCitationConstraints,
  exactContentInputColumns,
  exactContentInputConstraints
} from './exact-content-input.ts';
import { material_generation_requests, material_versions } from './material-versions.ts';

export const material_evidence_inputs = sqliteTable(
  'material_evidence_inputs',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    version_id: integer()
      .$type<MaterialVersionId>()
      .references(() => material_versions.id, { onDelete: 'cascade' }),
    request_id: text().references(() => material_generation_requests.id, { onDelete: 'cascade' }),
    position: integer().$type<bigint>().notNull(),
    ...exactContentInputColumns()
  },
  (t) => [
    uniqueIndex('material_evidence_inputs_version_owner').on(t.id, t.version_id),
    uniqueIndex('material_evidence_inputs_version_position').on(t.version_id, t.position),
    uniqueIndex('material_evidence_inputs_request_position').on(t.request_id, t.position),
    index('material_evidence_inputs_document').on(t.document_version_id),
    index('material_evidence_inputs_source').on(
      t.source_id,
      t.source_revision,
      t.source_snapshot_id
    ),
    ...exactContentInputConstraints(t),
    check(
      'material_evidence_input_owner',
      sql`(${t.version_id} IS NULL)!=(${t.request_id} IS NULL) AND ${t.position}>=0`
    )
  ]
);

export const material_evidence_citations = sqliteTable(
  'material_evidence_citations',
  {
    version_id: integer().$type<MaterialVersionId>().notNull(),
    ...exactCitationColumns()
  },
  (t) => [
    ...exactCitationConstraints(t, material_evidence_inputs, true),
    check(
      'material_evidence_citation_value',
      sql`${t.marker} BETWEEN 1 AND 4294967295 AND json_valid(${t.anchor}) AND (${t.target} IS NULL OR json_valid(${t.target})) AND length(${t.quote})>0`
    )
  ]
);

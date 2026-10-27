import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
  foreignKey,
  check
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { validAnchor } from './anchor-validity.ts';
import { documents } from './documents.ts';
import { material_versions, material_version_inputs } from './material-versions.ts';
import { sources } from './sources.ts';

function identity<K extends 'file' | 'audio' | 'video' | 'image' | 'link' | 'document' | 'diagram'>(
  kind: K
) {
  return {
    version_id: integer().$type<bigint>().primaryKey(),
    kind: text({ enum: [kind] })
      .notNull()
      .default(kind)
  };
}

function ownership<K extends string>(
  t: { version_id: AnySQLiteColumn; kind: AnySQLiteColumn },
  kind: K
) {
  return [
    foreignKey({
      columns: [t.version_id, t.kind],
      foreignColumns: [material_versions.id, material_versions.kind]
    }).onDelete('cascade'),
    check('payload_kind_check', sql`${t.kind} = ${sql.raw("'" + kind + "'")}`)
  ];
}

function sourceId() {
  return integer()
    .$type<bigint>()
    .notNull()
    .references(() => sources.id, { onDelete: 'no action' });
}

/** Original bytes and MIME metadata remain in the canonical sources/source_blobs tables. */
export const material_file_versions = sqliteTable(
  'material_file_versions',
  {
    ...identity('file'),
    source_id: sourceId()
  },
  (t) => [...ownership(t, 'file'), index('material_file_versions_source_idx').on(t.source_id)]
);

export const material_audio_versions = sqliteTable(
  'material_audio_versions',
  {
    ...identity('audio'),
    source_id: sourceId(),
    duration_ms: integer().$type<bigint>(),
    sample_rate: integer().$type<bigint>(),
    channels: integer().$type<bigint>()
  },
  (t) => [
    ...ownership(t, 'audio'),
    index('material_audio_versions_source_idx').on(t.source_id),
    check(
      'material_audio_duration_check',
      sql`duration_ms IS NULL OR (typeof(duration_ms) = 'integer' AND duration_ms >= 0)`
    ),
    check(
      'material_audio_sample_rate_check',
      sql`sample_rate IS NULL OR (typeof(sample_rate) = 'integer' AND sample_rate > 0)`
    ),
    check(
      'material_audio_channels_check',
      sql`channels IS NULL OR (typeof(channels) = 'integer' AND channels > 0)`
    )
  ]
);

export const material_video_versions = sqliteTable(
  'material_video_versions',
  {
    ...identity('video'),
    source_id: sourceId(),
    duration_ms: integer().$type<bigint>(),
    width: integer().$type<bigint>(),
    height: integer().$type<bigint>()
  },
  (t) => [
    ...ownership(t, 'video'),
    index('material_video_versions_source_idx').on(t.source_id),
    check(
      'material_video_duration_check',
      sql`duration_ms IS NULL OR (typeof(duration_ms) = 'integer' AND duration_ms >= 0)`
    ),
    check(
      'material_video_dimensions_check',
      sql`(width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL AND typeof(width) = 'integer' AND typeof(height) = 'integer' AND width > 0 AND height > 0)`
    )
  ]
);

export const material_image_versions = sqliteTable(
  'material_image_versions',
  {
    ...identity('image'),
    source_id: sourceId(),
    width: integer().$type<bigint>(),
    height: integer().$type<bigint>()
  },
  (t) => [
    ...ownership(t, 'image'),
    index('material_image_versions_source_idx').on(t.source_id),
    check(
      'material_image_dimensions_check',
      sql`(width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL AND typeof(width) = 'integer' AND typeof(height) = 'integer' AND width > 0 AND height > 0)`
    )
  ]
);

export const material_link_versions = sqliteTable(
  'material_link_versions',
  {
    ...identity('link'),
    source_id: sourceId()
  },
  (t) => [...ownership(t, 'link'), index('material_link_versions_source_idx').on(t.source_id)]
);

/** Extracted and authored documents use the same canonical anchored blocks. */
export const material_document_versions = sqliteTable(
  'material_document_versions',
  {
    ...identity('document'),
    document_id: integer()
      .$type<bigint>()
      .notNull()
      .references(() => documents.id, { onDelete: 'no action' })
  },
  (t) => [
    ...ownership(t, 'document'),
    uniqueIndex('material_document_versions_document_unique').on(t.document_id)
  ]
);

export const material_diagram_versions = sqliteTable(
  'material_diagram_versions',
  {
    ...identity('diagram'),
    format: text({ enum: ['mermaid'] }).notNull(),
    payload: text().notNull()
  },
  (t) => [
    ...ownership(t, 'diagram'),
    check('material_diagram_format_check', sql`format IN ('mermaid')`),
    check('material_diagram_payload_check', sql`length(trim(payload)) > 0`)
  ]
);

/** Citations always point to a declared input snapshot, never a mutable material head. */
export const material_version_citations = sqliteTable(
  'material_version_citations',
  {
    version_id: integer().$type<bigint>().notNull(),
    marker: integer().$type<bigint>().notNull(),
    input_version_id: integer().$type<bigint>().notNull(),
    anchor: text().notNull(),
    quote: text().notNull()
  },
  (t) => [
    uniqueIndex('material_version_citations_marker_unique').on(t.version_id, t.marker),
    index('material_version_citations_input_idx').on(t.input_version_id),
    foreignKey({
      columns: [t.version_id, t.input_version_id],
      foreignColumns: [material_version_inputs.version_id, material_version_inputs.input_version_id]
    }).onDelete('cascade'),
    check(
      'material_version_citations_marker_check',
      sql`typeof(marker) = 'integer' AND marker BETWEEN 1 AND 4294967295`
    ),
    check('material_version_citations_anchor_check', validAnchor(t.anchor)),
    check('material_version_citations_quote_check', sql`length(trim(quote)) > 0`)
  ]
);

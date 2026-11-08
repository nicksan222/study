import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import type { BlockId } from '@study/contracts/sources/document';

import {
  defineTable,
  sql,
  blob,
  check,
  foreignKey,
  integer,
  primaryKey,
  text
} from '../schema-builder.ts';
import { codes_source_kind } from './codes.ts';
import { content_snapshots, blocks } from './content-snapshots.ts';
import { sources } from './sources.ts';

export const source_processing = defineTable({ role: 'contributes', entity: 'passage' })(
  'source_processing',
  {
    source_id: integer()
      .primaryKey()
      .$type<SourceId>()
      .references(() => sources.id, { onDelete: 'cascade' }),
    revision: integer().$type<bigint>().notNull(),
    request_id: text().notNull(),
    published_request_id: text(),
    document_id: integer()
      .$type<ContentSnapshotId>()
      .references(() => content_snapshots.id, { onDelete: 'set null' })
  },
  (t) => [
    check('source_processing_revision_check', sql`${t.revision} > 0`),
    check('source_processing_request_check', sql`length(${t.request_id}) > 0`)
  ]
);

export const source_snapshots = defineTable({ role: 'contributes', entity: 'source' })(
  'source_snapshots',
  {
    source_id: integer()
      .$type<SourceId>()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    revision: integer().$type<bigint>().notNull(),
    bytes: blob({ mode: 'buffer' }).notNull(),
    kind: text({ enum: codes_source_kind.code.enumValues }).notNull().default('other'),
    mime: text().notNull().default('application/octet-stream'),
    uri: text()
  },
  (t) => [
    primaryKey({ columns: [t.source_id, t.revision] }),
    check('source_snapshots_revision_check', sql`${t.revision} > 0`)
  ]
);

/** Explicit retention roots for copied managed images, independent of membership/note. */
export const document_assets = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'document_assets',
  {
    document_id: integer().$type<ContentSnapshotId>().notNull(),
    block_id: text().$type<BlockId>().notNull(),
    source_id: integer().$type<SourceId>().notNull(),
    revision: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.document_id, t.block_id] }),
    foreignKey({
      columns: [t.document_id, t.block_id],
      foreignColumns: [blocks.document_id, blocks.editing_id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.source_id, t.revision],
      foreignColumns: [source_snapshots.source_id, source_snapshots.revision]
    })
  ]
);

/** Sources owns exact extraction publication identities independently of Material projections. */
export const source_extraction_revisions = defineTable({ role: 'contributes', entity: 'passage' })(
  'source_extraction_revisions',
  {
    source_id: integer().$type<SourceId>().notNull(),
    revision: integer().$type<bigint>().notNull(),
    snapshot_id: integer()
      .$type<ContentSnapshotId>()
      .notNull()
      .references(() => content_snapshots.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.source_id, t.revision, t.snapshot_id] }),
    foreignKey({
      columns: [t.source_id, t.revision],
      foreignColumns: [source_snapshots.source_id, source_snapshots.revision]
    }).onDelete('cascade')
  ]
);

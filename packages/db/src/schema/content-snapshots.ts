import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import type { BlockId } from '@study/contracts/sources/document';

import { contentSnapshotReference } from '../columns.ts';
import { defineTable, sql, integer, text, uniqueIndex, index, check } from '../schema-builder.ts';
import type { AnySQLiteColumn } from '../schema-builder.ts';
import { codes_block_kind, codes_extractor_kind } from './codes.ts';
import { sources } from './sources.ts';

export const content_snapshots = defineTable({ role: 'contributes', entity: 'passage' })(
  'content_snapshots',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<ContentSnapshotId>(),
    source_id: integer()
      .$type<SourceId>()
      .references((): AnySQLiteColumn => sources.id, { onDelete: 'cascade' }),
    extractor: text({ enum: codes_extractor_kind.code.enumValues }).references(
      (): AnySQLiteColumn => codes_extractor_kind.code,
      { onDelete: 'no action' }
    ),
    extractor_version: integer().$type<bigint>().notNull(),
    meta: text().notNull(),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    index('documents_source_id_idx').on(t.source_id, t.id),
    check('documents_check_1', sql`extractor_version >= 0`),
    check('documents_check_2', sql`json_valid(meta)`)
  ]
);

export const blocks = defineTable({ role: 'contributes', entity: 'page' })(
  'blocks',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    document_id: contentSnapshotReference(() => content_snapshots.id),
    ordinal: integer().$type<bigint>().notNull(),
    kind: text({ enum: codes_block_kind.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_block_kind.code, {
        onDelete: 'no action'
      }),
    editing_id: text().$type<BlockId>().notNull(),
    content: text().notNull(),
    text: text().notNull(),
    anchor: text().notNull()
  },
  (t) => [
    uniqueIndex('blocks_document_editing_id_unique').on(t.document_id, t.editing_id),
    check('blocks_content_json', sql`json_valid(content)`),
    uniqueIndex('blocks_document_id_ordinal_unique').on(t.document_id, t.ordinal),
    check('blocks_check_1', sql`ordinal >= 0`),
    check('blocks_check_2', sql`json_valid(anchor)`)
  ]
);

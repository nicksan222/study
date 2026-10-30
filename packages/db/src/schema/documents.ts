import type { DocumentId, SourceId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { codes_block_kind, codes_extractor_kind } from './codes.ts';
import { sources } from './sources.ts';

export const documents = sqliteTable(
  'documents',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<DocumentId>(),
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

export const blocks = sqliteTable(
  'blocks',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    document_id: integer()
      .$type<DocumentId>()
      .notNull()
      .references((): AnySQLiteColumn => documents.id, { onDelete: 'cascade' }),
    ordinal: integer().$type<bigint>().notNull(),
    kind: text({ enum: codes_block_kind.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_block_kind.code, {
        onDelete: 'no action'
      }),
    text: text().notNull(),
    anchor: text().notNull()
  },
  (t) => [
    uniqueIndex('blocks_document_id_ordinal_unique').on(t.document_id, t.ordinal),
    check('blocks_check_1', sql`ordinal >= 0`),
    check('blocks_check_2', sql`json_valid(anchor)`)
  ]
);

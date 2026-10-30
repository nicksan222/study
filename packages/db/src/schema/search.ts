import type { ChunkId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  text,
  blob,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/sqlite-core';

import { documentReference } from '../columns.ts';
import { documents } from './documents.ts';

export const chunks = sqliteTable(
  'chunks',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<ChunkId>(),
    document_id: documentReference(() => documents.id),
    ordinal: integer().$type<bigint>().notNull(),
    first_block: integer().$type<bigint>().notNull(),
    last_block: integer().$type<bigint>().notNull(),
    anchor: text().notNull(),
    text: text().notNull(),
    content_hash: blob({ mode: 'buffer' }).notNull()
  },
  (t) => [
    index('chunks_content_hash_idx').on(t.content_hash),
    uniqueIndex('chunks_document_id_ordinal_unique').on(t.document_id, t.ordinal),
    check('chunks_check_1', sql`ordinal >= 0`),
    check('chunks_check_2', sql`last_block >= first_block`),
    check('chunks_check_3', sql`json_valid(anchor)`),
    check('chunks_check_4', sql`length(content_hash) = 32`)
  ]
);

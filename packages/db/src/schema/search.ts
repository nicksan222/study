import type { ChunkId } from '@study/contracts/ids';

import { contentSnapshotReference } from '../columns.ts';
import {
  defineTable,
  sql,
  integer,
  text,
  blob,
  index,
  uniqueIndex,
  check
} from '../schema-builder.ts';
import { content_snapshots } from './content-snapshots.ts';

export const chunks = defineTable({
  role: 'entity',
  projection: 'feature',
  kind: 'passage',
  description: 'Published extracted passages with source anchors',
  textColumns: ['text']
})(
  'chunks',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<ChunkId>(),
    document_id: contentSnapshotReference(() => content_snapshots.id),
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

import { decodeBlockContent } from '@study/contracts/sources/document';
import { blockSchema } from '@study/contracts/sources/schemas';
import type * as s from '@study/db/schema';
import { Schema } from 'effect';

/** Decode one retained canonical block without choosing an application owner or current head. */
export function decodeStoredBlock(row: typeof s.blocks.$inferSelect) {
  return Schema.decodeUnknownSync(blockSchema)({
    id: row.editing_id,
    kind: row.kind,
    content: decodeBlockContent(row.content),
    text: row.text,
    anchor: JSON.parse(row.anchor)
  });
}

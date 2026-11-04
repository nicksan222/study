import { createHash } from 'node:crypto';

import type { SourceId } from '@study/contracts/ids';
import { encodeBlockContent } from '@study/contracts/sources/document';
import type { Document } from '@study/contracts/sources/document';
import { documentSchema } from '@study/contracts/sources/schemas';
import type { Db } from '@study/db';
import { blocks, content_snapshots, chunks } from '@study/db/schema';
import { Schema } from 'effect';

export function snapshot(db: Db, document: Document, time: bigint, sourceId: SourceId | null) {
  Schema.decodeUnknownSync(documentSchema)(document);

  const row = db.orm
    .insert(content_snapshots)
    .values({
      source_id: sourceId,
      extractor: document.meta.extractor as typeof content_snapshots.$inferInsert.extractor,
      extractor_version: BigInt(document.meta.extractorVersion),
      meta: JSON.stringify(document.meta),
      created_at: time
    })
    .returning()
    .get();

  for (const [ordinal, block] of document.blocks.entries()) {
    db.orm
      .insert(blocks)
      .values({
        document_id: row.id,
        ordinal: BigInt(ordinal),
        kind: block.kind,
        editing_id: block.id,
        content: encodeBlockContent(block.content),
        text: block.text,
        anchor: JSON.stringify(block.anchor)
      })
      .run();
    db.orm
      .insert(chunks)
      .values({
        document_id: row.id,
        ordinal: BigInt(ordinal),
        first_block: BigInt(ordinal),
        last_block: BigInt(ordinal),
        anchor: JSON.stringify(block.anchor),
        text: block.text,
        content_hash: createHash('sha256').update(block.text).digest()
      })
      .run();
  }

  return row.id;
}

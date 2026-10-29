import { createHash } from 'node:crypto';

import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { DocumentId } from '#server/shared/ids';
import type { PassageDraft } from '#server/shared/search/types';

export function replacePassages(
  ctx: ServerContext,
  id: DocumentId,
  passages: PassageDraft[]
): void {
  ctx.transaction(() => {
    if (
      !ctx.db.orm
        .select({
          id: schema.documents.id
        })
        .from(schema.documents)
        .where(sql`id=${id}`)
        .get()
    )
      throw new StudyError('not_found', 'document not found');

    const count = ctx.db.orm
      .select({
        count: sql`count(*)`
      })
      .from(schema.blocks)
      .where(sql`document_id=${id}`)
      .get()!.count as bigint;

    ctx.db.orm
      .delete(schema.chunks)
      .where(sql`document_id=${id}`)
      .run();
    passages.forEach((p, i) => {
      if (
        !Number.isSafeInteger(p.firstBlock) ||
        !Number.isSafeInteger(p.lastBlock) ||
        p.firstBlock < 0 ||
        p.lastBlock < p.firstBlock ||
        BigInt(p.lastBlock) >= count ||
        !p.text.trim()
      )
        throw new StudyError('invalid_input', 'invalid passage');

      ctx.db.orm
        .insert(schema.chunks)
        .values({
          document_id: id,
          ordinal: BigInt(i),
          first_block: BigInt(p.firstBlock),
          last_block: BigInt(p.lastBlock),
          anchor: JSON.stringify(p.anchor),
          text: p.text,
          content_hash: createHash('sha256').update(p.text).digest()
        })
        .run();
    });
  });
}

import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { enqueueJob as dbEnqueueJob } from '#server/procedures/jobs/worker';
import type { ServerContext } from '#server/runtime/context';
import type { SourceId, DocumentId } from '#server/shared/ids';

import {
  documentOf as dbDocumentOf,
  insertDocument as dbInsertDocument,
  now
} from './source-document.ts';

export function correctBlock(
  ctx: ServerContext,
  sourceId: SourceId,
  expectedDocumentId: DocumentId,
  ordinal: number,
  before: string,
  after: string
): DocumentId | null {
  return ctx.transaction(() => {
    const found = dbDocumentOf(ctx, sourceId);
    const block = found?.document.blocks[ordinal];

    if (!found || found.id !== expectedDocumentId || !block || block.text !== before) return null;

    ctx.db.orm
      .update(schema.jobs)
      .set({
        status: 'cancelled',
        waiting_for: null,
        updated_at: now(),
        finished_at: now()
      })
      .where(
        sql`kind='extract' AND source_id=${sourceId} AND status IN ('queued','blocked','waiting','running','failed')`
      )
      .run();

    block.text = after.trim();
    found.document.meta.corrected = true;
    const id = dbInsertDocument(ctx, sourceId, found.document);

    dbEnqueueJob(ctx, {
      kind: 'index',
      target: {
        type: 'document',
        id
      }
    });

    return id;
  });
}

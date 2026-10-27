import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { enqueueJob as dbEnqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { SourceId, DocumentId } from '#backend/shared/ids';

import {
  documentOf as dbDocumentOf,
  insertDocument as dbInsertDocument,
  now
} from './source-document.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput,
      ordinal: z.number().int().min(0).max(1000000).default(0),
      before: z.string().default(''),
      after: z.string().default(''),
      documentId: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;
    const id = r.id;
    const documentId = r.documentId;

    return {
      value: correctBlock(store, id, documentId, r.ordinal, r.before, r.after) !== null
    };
  });

export function correctBlock(
  ctx: BackendContext,
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

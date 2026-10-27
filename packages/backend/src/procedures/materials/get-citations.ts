import * as s from '@study/db/schema';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';

import { versionRow } from './reads.ts';
import { materialId, anchorSchema } from './schemas.ts';

export function readCitations(store: BackendContext, id: bigint) {
  versionRow(store, id);

  return store.db.orm
    .select()
    .from(s.material_version_citations)
    .where(eq(s.material_version_citations.version_id, id))
    .orderBy(asc(s.material_version_citations.marker))
    .all()
    .map((r) => ({
      marker: r.marker,
      inputVersionId: r.input_version_id,
      anchor: anchorSchema.parse(JSON.parse(r.anchor)),
      quote: r.quote
    }));
}

export const run = publicProcedure
  .input(z.object({ id: materialId }))
  .query(({ ctx, input }) => readCitations(ctx.store, input.id));

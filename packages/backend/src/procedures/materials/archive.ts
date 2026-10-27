import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';

import { materialRow, readMaterial, required } from './reads.ts';
import { materialId } from './schemas.ts';
import { materialTransaction } from './transactions.ts';
import { now } from './writes.ts';

export function setArchived(store: BackendContext, id: bigint, archived: boolean) {
  return materialTransaction(store, () => {
    materialRow(store, id);
    const timestamp = now();

    store.db.orm
      .update(s.materials)
      .set({ archived_at: archived ? timestamp : null, updated_at: timestamp })
      .where(eq(s.materials.id, id))
      .run();

    return required(readMaterial(store, id));
  });
}

export const run = publicProcedure
  .input(z.object({ id: materialId }))
  .mutation(({ ctx, input }) => setArchived(ctx.store, input.id, true));

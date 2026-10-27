import * as s from '@study/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';

import { materialRow } from './reads.ts';
import { materialId } from './schemas.ts';
import { materialTransaction } from './transactions.ts';
import { assertSession } from './writes.ts';

export const membershipSchema = z.object({ sessionId: materialId, materialId });

export function attachMaterial(store: BackendContext, sessionId: bigint, materialId: bigint) {
  const material = materialRow(store, materialId, true);

  assertSession(store, sessionId, material.project_id);

  if (
    store.db.orm
      .select()
      .from(s.session_materials)
      .where(
        and(
          eq(s.session_materials.session_id, sessionId),
          eq(s.session_materials.material_id, materialId)
        )
      )
      .get()
  )
    return;

  const last = store.db.orm
    .select()
    .from(s.session_materials)
    .where(eq(s.session_materials.session_id, sessionId))
    .orderBy(desc(s.session_materials.position))
    .get();

  store.db.orm
    .insert(s.session_materials)
    .values({
      session_id: sessionId,
      material_id: materialId,
      project_id: material.project_id,
      position: (last?.position ?? -1n) + 1n
    })
    .run();
}

export const run = publicProcedure.input(membershipSchema).mutation(({ ctx, input }) =>
  materialTransaction(ctx.store, () => {
    attachMaterial(ctx.store, input.sessionId, input.materialId);

    return input;
  })
);

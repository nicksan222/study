import * as s from '@study/db/schema';
import { and, desc, eq } from 'drizzle-orm';

import { materialRow } from '#backend/procedures/materials/reads';
import { materialTransaction } from '#backend/procedures/materials/transactions';
import { assertSession } from '#backend/procedures/materials/writes';
import type { BackendContext } from '#backend/runtime/context';

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

export function attachMaterialTransaction(
  store: BackendContext,
  sessionId: bigint,
  materialId: bigint
) {
  return materialTransaction(store, () => attachMaterial(store, sessionId, materialId));
}

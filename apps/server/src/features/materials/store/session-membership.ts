import type { MaterialId, SessionId } from '@study/contracts/ids';
import { and, desc, eq } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { makeWrites } from '#server/features/materials/store/writes';
import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeSessionMembership(resources: StoreResources) {
  const { db: store } = resources;
  const { materialRow } = makeReads(resources);
  const { assertSession } = makeWrites(resources);

  function attachMaterial(sessionId: SessionId, materialId: MaterialId) {
    const material = materialRow(materialId, true);

    assertSession(sessionId, material.project_id);

    if (
      store.orm
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

    const last = store.orm
      .select()
      .from(s.session_materials)
      .where(eq(s.session_materials.session_id, sessionId))
      .orderBy(desc(s.session_materials.position))
      .get();

    store.orm
      .insert(s.session_materials)
      .values({
        session_id: sessionId,
        material_id: materialId,
        project_id: material.project_id,
        position: (last?.position ?? -1n) + 1n
      })
      .run();
  }

  function attachMaterialTransaction(sessionId: SessionId, materialId: MaterialId) {
    return materialIntegrity(() => attachMaterial(sessionId, materialId));
  }

  return { attachMaterial, attachMaterialTransaction };
}

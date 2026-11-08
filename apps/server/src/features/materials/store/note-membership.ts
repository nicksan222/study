/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads and checks membership links between study notes and materials.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Maintains links between notes and materials within project ownership.                  │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialId, NoteId } from '@study/contracts/ids';
import { and, desc, eq } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { makeWrites } from '#server/features/materials/store/writes';
import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeNoteMembership(resources: StoreResources) {
  const { db: store } = resources;
  const { materialRow } = makeReads(resources);
  const { assertNote } = makeWrites(resources);

  function attachMaterial(noteId: NoteId, materialId: MaterialId) {
    materialRow(materialId, true);

    assertNote(noteId);

    if (
      store.orm
        .select()
        .from(s.note_materials)
        .where(
          and(eq(s.note_materials.note_id, noteId), eq(s.note_materials.material_id, materialId))
        )
        .get()
    )
      return;

    const last = store.orm
      .select()
      .from(s.note_materials)
      .where(eq(s.note_materials.note_id, noteId))
      .orderBy(desc(s.note_materials.position))
      .get();

    store.orm
      .insert(s.note_materials)
      .values({
        note_id: noteId,
        material_id: materialId,
        position: (last?.position ?? -1n) + 1n
      })
      .run();
  }

  function attachMaterialTransaction(noteId: NoteId, materialId: MaterialId) {
    return materialIntegrity(() => attachMaterial(noteId, materialId));
  }

  return { attachMaterial, attachMaterialTransaction };
}

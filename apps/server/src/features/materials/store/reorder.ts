/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Changes material ordering within its owning project.                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists project-local ordering without changing material content.                     │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { reorderInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import type { StoreResources } from '@study/server';

type Input = typeof reorderInputSchema.Type;

import * as s from '@study/db';
import { eq } from '@study/db';

import { required } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';

export function makeReorder({ db: store }: StoreResources) {
  const reorder = (input: Input) =>
    materialIntegrity(() => {
      const db = store.orm;

      required(db.select().from(s.notes).where(eq(s.notes.id, input.noteId)).get());
      const rows = db
        .select()
        .from(s.note_materials)
        .where(eq(s.note_materials.note_id, input.noteId))
        .all();

      if (
        new Set(input.materialIds).size !== input.materialIds.length ||
        rows.length !== input.materialIds.length ||
        rows.some((row) => !input.materialIds.includes(row.material_id))
      )
        throw new StudyError(
          'invalid_input',
          'Reorder must include each note material exactly once'
        );

      db.delete(s.note_materials).where(eq(s.note_materials.note_id, input.noteId)).run();
      input.materialIds.forEach((id, index) => {
        const row = required(rows.find((item) => item.material_id === id));

        db.insert(s.note_materials)
          .values({ ...row, position: BigInt(index) })
          .run();
      });

      return { materialIds: input.materialIds };
    });

  return { reorder };
}

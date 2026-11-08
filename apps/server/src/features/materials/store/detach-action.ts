/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Detaches a material from a project through the store transaction boundary.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Removes project attachment state through the owning transaction helper.                │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { detachInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof detachInputSchema.Type;

import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { makeWrites } from '#server/features/materials/store/writes';

export function makeDetachAction(resources: StoreResources) {
  const { db } = resources;
  const store = db;
  const { materialRow } = makeReads(resources);
  const { assertNote } = makeWrites(resources);
  const detach = (input: Input) =>
    materialIntegrity(() => {
      materialRow(input.materialId);

      assertNote(input.noteId);
      store.orm
        .delete(s.note_materials)
        .where(
          and(
            eq(s.note_materials.note_id, input.noteId),
            eq(s.note_materials.material_id, input.materialId)
          )
        )
        .run();

      return input;
    });

  return {
    detach
  };
}

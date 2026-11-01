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

import { StudyError } from '@study/contracts/errors';
import type { reorderInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof reorderInputSchema.Type;

import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { required } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';

export function makeReorderAction({ db: store }: StoreResources) {
  const reorder = (input: Input) =>
    materialIntegrity(() => {
      const db = store.orm;

      required(db.select().from(s.sessions).where(eq(s.sessions.id, input.sessionId)).get());
      const rows = db
        .select()
        .from(s.session_materials)
        .where(eq(s.session_materials.session_id, input.sessionId))
        .all();

      if (
        new Set(input.materialIds).size !== input.materialIds.length ||
        rows.length !== input.materialIds.length ||
        rows.some((row) => !input.materialIds.includes(row.material_id))
      )
        throw new StudyError(
          'invalid_input',
          'Reorder must include each session material exactly once'
        );

      db.delete(s.session_materials)
        .where(eq(s.session_materials.session_id, input.sessionId))
        .run();
      input.materialIds.forEach((id, index) => {
        const row = required(rows.find((item) => item.material_id === id));

        db.insert(s.session_materials)
          .values({ ...row, position: BigInt(index) })
          .run();
      });

      return { materialIds: input.materialIds };
    });

  return { reorder };
}

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Updates a material title through its typed store mutation.                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Writes material names within the owning project scope.                                 │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { renameInputSchema, updateDescriptionInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import * as s from '@study/db';
import { eq } from '@study/db';
import type { StoreResources } from '@study/server';

type Input = typeof renameInputSchema.Type;

import { makeReads, required } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { now } from '#server/features/materials/store/writes';

export function makeRename(resources: StoreResources) {
  const { db: store, timestampClock } = resources;
  const { materialRow, readMaterial } = makeReads(resources);
  const rename = (input: Input) =>
    materialIntegrity(() => {
      materialRow(input.id, true);
      store.orm
        .update(s.materials)
        .set({ title: input.title, updated_at: now(timestampClock) })
        .where(eq(s.materials.id, input.id))
        .run();

      return required(readMaterial(input.id));
    });

  const updateDescription = (input: typeof updateDescriptionInputSchema.Type) =>
    materialIntegrity(() => {
      const row = materialRow(input.id, true);
      const description = input.description?.trim() || null;

      if (row.description !== input.expectedDescription && row.description !== description)
        throw new StudyError('invalid_input', 'Document description changed before save');

      store.orm
        .update(s.materials)
        .set({ description, updated_at: now(timestampClock) })
        .where(eq(s.materials.id, input.id))
        .run();

      return required(readMaterial(input.id));
    });

  return { rename, updateDescription };
}

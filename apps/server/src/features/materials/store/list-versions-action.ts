/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Lists the version history for a material.                                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Returns the version sequence associated with one material.                             │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { materialVersionsInputSchema } from '@study/contracts/materials/rpc';

type Input = typeof materialVersionsInputSchema.Type;

import { and, desc, eq, lt } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads } from '#server/features/materials/store/reads';
import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeListVersionsAction(resources: StoreResources) {
  const { db: store } = resources;
  const { materialRow } = makeReads(resources);
  const listVersions = (input: Input) => {
    materialRow(input.materialId);

    if (
      input.cursor !== undefined &&
      store.orm
        .select()
        .from(s.material_versions)
        .where(eq(s.material_versions.id, input.cursor))
        .get()?.material_id !== input.materialId
    )
      throw new StudyError('invalid_input', 'Invalid version cursor');

    const rows = store.orm
        .select()
        .from(s.material_versions)
        .where(
          and(
            eq(s.material_versions.material_id, input.materialId),
            input.cursor === undefined ? undefined : lt(s.material_versions.id, input.cursor)
          )
        )
        .orderBy(desc(s.material_versions.id))
        .limit(input.limit + 1)
        .all(),
      page = rows.slice(0, input.limit);

    return {
      items: page.map((v) =>
        store.orm
          .select()
          .from(s.material_history_members)
          .where(eq(s.material_history_members.version_id, v.id))
          .get()
          ? { ...v, instruction: null, language: null, availability: 'unavailable' as const }
          : v
      ),
      nextCursor: rows.length > input.limit ? page.at(-1)!.id : null
    };
  };

  return { listVersions };
}

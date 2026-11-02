/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Lists project materials with the requested filters and ordering.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Applies project, archive, and ordering constraints to material listings.               │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialId } from '@study/contracts/ids';
import type { materialsInputSchema } from '@study/contracts/materials/rpc';

type Input = typeof materialsInputSchema.Type;

import { and, asc, desc, eq, gt, isNotNull, isNull, lt, inArray } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads, required } from '#server/features/materials/store/reads';
import { makeWrites } from '#server/features/materials/store/writes';
import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeListAction(resources: StoreResources) {
  const { db: store } = resources;
  const { materialRow, readMaterialSummaries } = makeReads(resources);
  const { assertProject, assertSession, assertMembership } = makeWrites(resources);
  const filtersFor = (input: Input) => {
    if (input.projectId !== undefined) assertProject(input.projectId);

    return [
      input.projectId === undefined
        ? undefined
        : inArray(
            s.materials.id,
            store.orm
              .select({ id: s.project_materials.material_id })
              .from(s.project_materials)
              .where(eq(s.project_materials.project_id, input.projectId))
          ),
      input.archived ? isNotNull(s.materials.archived_at) : isNull(s.materials.archived_at)
    ];
  };
  const list = (input: Input) => {
    const filters = filtersFor(input);

    if (input.cursor !== undefined) {
      materialRow(input.cursor);

      if (input.projectId !== undefined) assertMembership(input.projectId, input.cursor);
    }

    let ids: MaterialId[];

    if (input.sessionId !== undefined) {
      assertSession(input.sessionId);
      const cursor =
        input.cursor === undefined
          ? undefined
          : required(
              store.orm
                .select()
                .from(s.session_materials)
                .where(
                  and(
                    eq(s.session_materials.session_id, input.sessionId),
                    eq(s.session_materials.material_id, input.cursor)
                  )
                )
                .get()
            );

      ids = store.orm
        .select({ id: s.materials.id })
        .from(s.materials)
        .innerJoin(s.session_materials, eq(s.materials.id, s.session_materials.material_id))
        .where(
          and(
            ...filters,
            eq(s.session_materials.session_id, input.sessionId),
            cursor ? gt(s.session_materials.position, cursor.position) : undefined
          )
        )
        .orderBy(asc(s.session_materials.position))
        .limit(input.limit + 1)
        .all()
        .map((row) => row.id);
    } else
      ids = store.orm
        .select({ id: s.materials.id })
        .from(s.materials)
        .where(
          and(...filters, input.cursor === undefined ? undefined : lt(s.materials.id, input.cursor))
        )
        .orderBy(desc(s.materials.id))
        .limit(input.limit + 1)
        .all()
        .map((row) => row.id);

    const page = ids.slice(0, input.limit);

    return {
      items: readMaterialSummaries(page),
      nextCursor: ids.length > input.limit ? page.at(-1)! : null
    };
  };

  return { list };
}

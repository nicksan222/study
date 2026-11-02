/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads and validates parent and input version relationships.                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks parent and input links against project, status, and material ownership.         │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { inputsInputSchema } from '@study/contracts/materials/rpc';
import { and, asc, eq, gt } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads } from '#server/features/materials/store/reads';
import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof inputsInputSchema.Type;

export function makeLinkedVersions(resources: StoreResources) {
  const { db: store } = resources;
  const { versionRow } = makeReads(resources);
  const linkedVersions = (input: Input, direction: 'inputs' | 'dependents') => {
    const owner =
      direction === 'inputs'
        ? s.material_version_inputs.version_id
        : s.material_version_inputs.input_version_id;
    const target =
      direction === 'inputs'
        ? s.material_version_inputs.input_version_id
        : s.material_version_inputs.version_id;

    versionRow(input.id);
    const rows = store.orm
        .select({ version: s.material_versions })
        .from(s.material_version_inputs)
        .innerJoin(s.material_versions, eq(s.material_versions.id, target))
        .where(
          and(
            eq(owner, input.id),
            input.cursor === undefined ? undefined : gt(target, input.cursor)
          )
        )
        .orderBy(asc(target))
        .limit(input.limit + 1)
        .all(),
      page = rows.slice(0, input.limit);

    return {
      items: page.map((row) =>
        store.orm
          .select()
          .from(s.material_deletion_members)
          .where(eq(s.material_deletion_members.material_id, row.version.material_id))
          .get()
          ? {
              ...row.version,
              instruction: null,
              language: null,
              availability: 'unavailable' as const
            }
          : row.version
      ),
      nextCursor: rows.length > input.limit ? page.at(-1)!.version.id : null
    };
  };

  return linkedVersions;
}

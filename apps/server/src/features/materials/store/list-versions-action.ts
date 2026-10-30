import { StudyError } from '@study/contracts/errors';
import type { materialVersionsInputSchema } from '@study/contracts/materials/rpc';

type Input = typeof materialVersionsInputSchema.Type;

import { and, desc, eq, lt } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads } from '#server/features/materials/store/reads';
import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeListVersionsAction(resources: StoreResources) {
  const { db: store } = resources;
  const { materialRow, versionRow } = makeReads(resources);
  const listVersions = (input: Input) => {
    materialRow(input.materialId);

    if (input.cursor !== undefined && versionRow(input.cursor).material_id !== input.materialId)
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
      items: page,
      nextCursor: rows.length > input.limit ? page.at(-1)!.id : null
    };
  };

  return { listVersions };
}

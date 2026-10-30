import { StudyError } from '@study/contracts/errors';
import type { MaterialId } from '@study/contracts/ids';
import type { materialsInputSchema } from '@study/contracts/materials/rpc';

type Input = typeof materialsInputSchema.Type;

import { and, asc, desc, eq, gt, isNotNull, isNull, lt } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads, required } from '#server/features/materials/store/reads';
import { makeWrites } from '#server/features/materials/store/writes';
import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeListAction(resources: StoreResources) {
  const { db: store } = resources;
  const { materialRow, readMaterialSummaries } = makeReads(resources);
  const { assertProject, assertSession } = makeWrites(resources);
  const list = (input: Input) => {
    assertProject(input.projectId);
    const filters = [
      eq(s.materials.project_id, input.projectId),
      input.archived ? isNotNull(s.materials.archived_at) : isNull(s.materials.archived_at)
    ];

    if (input.cursor !== undefined) {
      const cursor = materialRow(input.cursor);

      if (cursor.project_id !== input.projectId)
        throw new StudyError('invalid_input', 'Invalid material cursor');
    }

    let ids: MaterialId[];

    if (input.sessionId !== undefined) {
      assertSession(input.sessionId, input.projectId);
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

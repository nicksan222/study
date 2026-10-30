import type { inputsInputSchema } from '@study/contracts/materials/rpc';
import { and, asc, eq, gt } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof inputsInputSchema.Type;

import { makeReads } from '#server/features/materials/store/reads';

export function makeGetInputsAction(resources: StoreResources) {
  const { db: store } = resources;
  const { versionRow } = makeReads(resources);
  const getInputs = (input: Input) => {
    versionRow(input.id);
    const rows = store.orm
        .select({ version: s.material_versions })
        .from(s.material_version_inputs)
        .innerJoin(
          s.material_versions,
          eq(s.material_versions.id, s.material_version_inputs.input_version_id)
        )
        .where(
          and(
            eq(s.material_version_inputs.version_id, input.id),
            input.cursor === undefined
              ? undefined
              : gt(s.material_version_inputs.input_version_id, input.cursor)
          )
        )
        .orderBy(asc(s.material_version_inputs.input_version_id))
        .limit(input.limit + 1)
        .all(),
      page = rows.slice(0, input.limit);

    return {
      items: page.map((row) => row.version),
      nextCursor: rows.length > input.limit ? page.at(-1)!.version.id : null
    };
  };

  return { getInputs };
}

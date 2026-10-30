import { StudyError } from '@study/contracts/errors';
import type { deleteDraftInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof deleteDraftInputSchema.Type;

import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { makeContent } from '#server/features/materials/store/content';
import { makeReads } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';

export function makeDeleteDraftAction(resources: StoreResources) {
  const { db } = resources;
  const store = db;
  const { removeContent } = makeContent(resources);
  const { versionRow } = makeReads(resources);
  const deleteDraft = (input: Input) =>
    materialIntegrity(() => {
      const version = versionRow(input.id, true),
        db = store.orm;

      if (
        db
          .select()
          .from(s.material_versions)
          .where(eq(s.material_versions.material_id, version.material_id))
          .all().length === 1
      )
        throw new StudyError('invalid_input', 'Cannot delete the only material version');

      db.delete(s.material_version_citations)
        .where(eq(s.material_version_citations.version_id, input.id))
        .run();
      db.delete(s.material_version_inputs)
        .where(eq(s.material_version_inputs.version_id, input.id))
        .run();
      db.delete(s.material_version_parents)
        .where(eq(s.material_version_parents.version_id, input.id))
        .run();
      removeContent(input.id);
      db.delete(s.material_versions).where(eq(s.material_versions.id, input.id)).run();

      return {
        id: input.id
      };
    });

  return {
    deleteDraft
  };
}

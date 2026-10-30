import { StudyError } from '@study/contracts/errors';
import type { setCitationsInputSchema } from '@study/contracts/materials/rpc';

type Input = typeof setCitationsInputSchema.Type;

import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeCitations } from './citations.ts';

export function makeSetCitationsAction(resources: StoreResources) {
  const { db: store } = resources;
  const { readCitations } = makeCitations(resources);
  const { versionRow } = makeReads(resources);
  const setCitations = (input: Input) =>
    materialIntegrity(() => {
      versionRow(input.id, true);
      const db = store.orm;
      const inputs = db
        .select()
        .from(s.material_version_inputs)
        .where(eq(s.material_version_inputs.version_id, input.id))
        .all();

      if (
        new Set(input.citations.map((citation) => citation.marker)).size !==
          input.citations.length ||
        input.citations.some(
          (citation) => !inputs.some((row) => row.input_version_id === citation.inputVersionId)
        )
      )
        throw new StudyError(
          'invalid_input',
          'Citations must refer to declared input versions with distinct markers'
        );

      db.delete(s.material_version_citations)
        .where(eq(s.material_version_citations.version_id, input.id))
        .run();

      for (const citation of input.citations)
        db.insert(s.material_version_citations)
          .values({
            version_id: input.id,
            marker: citation.marker,
            input_version_id: citation.inputVersionId,
            anchor: JSON.stringify(citation.anchor),
            quote: citation.quote
          })
          .run();

      return readCitations(input.id);
    });

  return { setCitations };
}

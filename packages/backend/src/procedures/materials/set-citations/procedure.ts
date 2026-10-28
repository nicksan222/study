import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { readCitations } from '#backend/procedures/materials/operations/citations';
import { versionRow } from '#backend/procedures/materials/reads';
import { materialTransaction } from '#backend/procedures/materials/transactions';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    materialTransaction(ctx.store, () => {
      versionRow(ctx.store, input.id, true);
      const db = ctx.store.db.orm;
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

      return readCitations(ctx.store, input.id);
    })
  );

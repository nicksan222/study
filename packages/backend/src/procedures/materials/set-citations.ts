import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';

import { readCitations } from './get-citations.ts';
import { versionRow } from './reads.ts';
import { materialId, citationSchema } from './schemas.ts';
import { materialTransaction } from './transactions.ts';

export const run = publicProcedure
  .input(z.object({ id: materialId, citations: z.array(citationSchema).max(10000) }))
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
        new Set(input.citations.map((c) => c.marker)).size !== input.citations.length ||
        input.citations.some((c) => !inputs.some((i) => i.input_version_id === c.inputVersionId))
      )
        throw new StudyError(
          'invalid_input',
          'Citations must refer to declared input versions with distinct markers'
        );

      db.delete(s.material_version_citations)
        .where(eq(s.material_version_citations.version_id, input.id))
        .run();

      for (const c of input.citations)
        db.insert(s.material_version_citations)
          .values({
            version_id: input.id,
            marker: c.marker,
            input_version_id: c.inputVersionId,
            anchor: JSON.stringify(c.anchor),
            quote: c.quote
          })
          .run();

      return readCitations(ctx.store, input.id);
    })
  );

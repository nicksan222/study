import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { insertContent, removeContent } from '#server/procedures/materials/content';
import { readVersion, required, versionRow } from '#server/procedures/materials/reads';
import { materialTransaction } from '#server/procedures/materials/transactions';
import { insertLinks, now } from '#server/procedures/materials/writes';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    materialTransaction(ctx.store, () => {
      const version = versionRow(ctx.store, input.id, true),
        db = ctx.store.db.orm;

      if (version.kind !== input.content.kind)
        throw new StudyError('invalid_input', 'Version kind must match material');

      db.delete(s.material_version_citations)
        .where(eq(s.material_version_citations.version_id, version.id))
        .run();
      db.delete(s.material_version_inputs)
        .where(eq(s.material_version_inputs.version_id, version.id))
        .run();
      db.delete(s.material_version_parents)
        .where(eq(s.material_version_parents.version_id, version.id))
        .run();
      removeContent(ctx.store, version.id);
      insertContent(ctx.store, version, input.content);
      insertLinks(ctx.store, version, input);
      db.update(s.material_versions)
        .set({
          operation: input.operation ?? version.operation,
          language: input.language === undefined ? version.language : input.language
        })
        .where(eq(s.material_versions.id, version.id))
        .run();
      db.update(s.materials)
        .set({ updated_at: now() })
        .where(eq(s.materials.id, version.material_id))
        .run();

      return required(readVersion(ctx.store, version.id));
    })
  );

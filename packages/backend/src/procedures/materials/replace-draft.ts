import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';

import { insertContent, removeContent } from './content.ts';
import { readVersion, required, versionRow } from './reads.ts';
import { createVersionSchema, materialId } from './schemas.ts';
import { materialTransaction } from './transactions.ts';
import { insertLinks, now } from './writes.ts';

export const run = publicProcedure
  .input(createVersionSchema.safeExtend({ id: materialId, publish: z.never().optional() }))
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

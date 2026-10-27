import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { originalVersion, sourceMaterial } from '#backend/procedures/ingestion/source-material';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { ProjectId } from '#backend/shared/ids';
import type { SourceId } from '#backend/shared/ids';

import { source } from './source.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput,
      project: idInput.nullish()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: setSourceProject(store, r.id, r.project ?? null)
    };
  });

export function setSourceProject(
  ctx: BackendContext,
  id: SourceId,
  projectId: ProjectId | null
): boolean {
  return ctx.transaction(() => {
    const current = source(ctx, id);

    if (!current) return false;

    if (current.projectId === projectId) return true;

    if (originalVersion(ctx, id))
      throw new StudyError('invalid_input', 'Published source ownership is immutable');

    ctx.db.orm
      .update(schema.sources)
      .set({ project_id: projectId })
      .where(sql`id = ${id}`)
      .run();
    sourceMaterial(ctx, source(ctx, id)!);

    return true;
  });
}

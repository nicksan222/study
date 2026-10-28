import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { originalVersion, sourceMaterial } from '#backend/procedures/ingestion/source-material';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { ProjectId, SourceId } from '#backend/shared/ids';

import { source } from './source.ts';

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

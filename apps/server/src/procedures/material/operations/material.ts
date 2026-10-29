import { desc, sql } from '@study/db';
import * as schema from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import type { ProjectId, ArtifactId } from '#server/shared/ids';
import type { Artifact } from '#server/shared/study/types';

import { artifact as opArtifact } from './artifact.ts';

export function listArtifacts(ctx: ServerContext, project: ProjectId): Artifact[] {
  return ctx.db.orm
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(
      sql`project_id=${project} AND (material_id IS NULL OR EXISTS(SELECT 1 FROM materials m WHERE m.id=artifacts.material_id AND m.archived_at IS NULL))`
    )
    .orderBy(desc(schema.artifacts.id))
    .all()
    .map((r) => opArtifact(ctx, r.id as ArtifactId)!);
}

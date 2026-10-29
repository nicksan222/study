import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { invalidateMaterial } from '#server/procedures/material/finish-material';
import type { ServerContext } from '#server/runtime/context';
import type { ArtifactId } from '#server/shared/ids';

import { artifact as opArtifact, now } from './artifact.ts';

export function deleteArtifact(ctx: ServerContext, id: ArtifactId): boolean {
  return ctx.transaction(() => {
    const artifact = opArtifact(ctx, id);

    if (!artifact) return false;

    if (artifact.status === 'complete') invalidateMaterial(ctx, id);

    if (artifact.materialId !== null)
      ctx.db.orm
        .update(schema.materials)
        .set({ archived_at: now(), updated_at: now() })
        .where(sql`id=${artifact.materialId}`)
        .run();

    return (
      ctx.db.orm
        .delete(schema.artifacts)
        .where(sql`id=${id}`)
        .run().changes !== 0n
    );
  });
}

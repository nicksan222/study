import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { invalidateMaterial } from '#backend/procedures/material/finish-material';
import type { BackendContext } from '#backend/runtime/context';
import type { ArtifactId } from '#backend/shared/ids';

import { artifact as opArtifact, now } from './artifact.ts';

export function deleteArtifact(ctx: BackendContext, id: ArtifactId): boolean {
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

import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ArtifactId } from '#backend/shared/ids';

import { artifact as opArtifact, now } from './artifact.ts';
import { invalidateMaterial as opInvalidateMaterial } from './finish-material.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: deleteArtifact(store, r.id)
    };
  });

export function deleteArtifact(ctx: BackendContext, id: ArtifactId): boolean {
  return ctx.transaction(() => {
    const artifact = opArtifact(ctx, id);

    if (!artifact) return false;

    if (artifact.status === 'complete') opInvalidateMaterial(ctx, id);

    if (artifact.materialId !== null)
      ctx.db.orm
        .update(schema.materials)
        .set({ archived_at: now(), updated_at: now() })
        .where(sql`id=${artifact.materialId}`)
        .run();

    const changed =
      ctx.db.orm
        .delete(schema.artifacts)
        .where(sql`id=${id}`)
        .run().changes !== 0n;

    return changed;
  });
}

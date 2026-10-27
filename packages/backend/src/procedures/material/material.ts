import * as schema from '@study/db/schema';
import { sql, desc } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ProjectId } from '#backend/shared/ids';
import type { ArtifactId } from '#backend/shared/ids';
import type { Artifact } from '#backend/shared/study/types';

import { artifactView, artifact as opArtifact } from './artifact.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;
    const all = listArtifacts(store, r.id);
    const grouped = new Map<string, typeof all>();

    for (const a of all) {
      const key = a.mistakes ? `mistakes:${a.id}` : a.kind;

      grouped.set(key, [...(grouped.get(key) ?? []), a]);
    }

    return {
      items: [...grouped.values()].map((items) => ({
        current: items.find((a) => a.status === 'complete')
          ? artifactView(
              store,
              items.find((a) => a.status === 'complete')!
            )
          : undefined,
        update: items.find((a) => a.status !== 'complete')
          ? artifactView(
              store,
              items.find((a) => a.status !== 'complete')!
            )
          : null
      }))
    };
  });

export function listArtifacts(ctx: BackendContext, project: ProjectId): Artifact[] {
  return ctx.db.orm
    .select({
      id: schema.artifacts.id
    })
    .from(schema.artifacts)
    .where(
      sql`project_id=${project} AND (material_id IS NULL OR EXISTS(SELECT 1 FROM materials m WHERE m.id=artifacts.material_id AND m.archived_at IS NULL))`
    )
    .orderBy(desc(schema.artifacts.id))
    .all()
    .map((r) => opArtifact(ctx, r.id as ArtifactId)!);
}

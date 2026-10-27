import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ProjectId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput.nullish(),
      since: z.bigint().default(0n)
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      items: reviewTimes(store, r.project ?? null, r.since)
    };
  });

export function reviewTimes(
  ctx: BackendContext,
  project: ProjectId | null,
  since: bigint
): bigint[] {
  return ctx.db.orm
    .all(
      sql`SELECT r.reviewed_at FROM reviews r JOIN cards c ON c.id=r.card_id JOIN artifacts a ON a.id=c.artifact_id WHERE r.reviewed_at>=${since} AND (${project} IS NULL OR a.project_id=${project}) ORDER BY r.reviewed_at`
    )
    .map((r) => r.reviewed_at as bigint);
}

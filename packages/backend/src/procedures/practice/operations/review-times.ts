import { sql } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { ProjectId } from '#backend/shared/ids';

export function reviewTimes(
  ctx: BackendContext,
  project: ProjectId | null,
  since: bigint
): bigint[] {
  return ctx.db.orm
    .all(
      sql`SELECT r.reviewed_at FROM reviews r JOIN cards c ON c.id=r.card_id JOIN artifacts a ON a.id=c.artifact_id WHERE r.reviewed_at>=${since} AND (${project} IS NULL OR a.project_id=${project}) ORDER BY r.reviewed_at`
    )
    .map((row) => row.reviewed_at as bigint);
}

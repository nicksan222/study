import { sql } from 'drizzle-orm';

import { readReviewSettings } from '#backend/procedures/settings/operations/get-review-settings';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { ProjectId } from '#backend/shared/ids';

export function countDueCards(
  ctx: BackendContext,
  project: ProjectId | null,
  at: bigint,
  newCards = 20
): number {
  if (!Number.isSafeInteger(newCards) || newCards < 0)
    throw new StudyError('invalid_input', 'invalid card allowance');

  const active = sql`(a.material_id IS NULL OR EXISTS(SELECT 1 FROM materials m WHERE m.id=a.material_id AND m.archived_at IS NULL))`;
  const reviewed = ctx.db.orm.get(
    sql`SELECT count(*) AS n FROM cards c JOIN artifacts a ON a.id=c.artifact_id WHERE ${active} AND c.due<=${at} AND c.reps>0 AND (${project} IS NULL OR a.project_id=${project})`
  )!.n as bigint;
  const fresh = ctx.db.orm.get(
    sql`SELECT count(*) AS n FROM (SELECT a.project_id FROM cards c JOIN artifacts a ON a.id=c.artifact_id WHERE ${active} AND c.due<=${at} AND c.reps=0 ORDER BY c.due,c.id LIMIT ${newCards}) WHERE (${project} IS NULL OR project_id=${project})`
  )!.n as bigint;

  return Number(reviewed + fresh);
}

export function newCardsSince(ctx: BackendContext, since: bigint): number {
  return Number(
    ctx.db.orm.get(
      sql`SELECT count(*) AS n FROM (SELECT min(reviewed_at) AS first FROM reviews GROUP BY card_id) WHERE first>=${since}`
    )!.n
  );
}

export function newCardAllowance(ctx: BackendContext): number {
  const midnight = new Date();

  midnight.setHours(0, 0, 0, 0);

  return Math.max(
    0,
    readReviewSettings(ctx).newCardsPerDay -
      newCardsSince(ctx, BigInt(Math.floor(midnight.getTime() / 1000)))
  );
}

import type { cards } from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { cardRow } from '#backend/procedures/material/operations/artifact';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { ProjectId } from '#backend/shared/ids';
import type { Card } from '#backend/shared/study/types';

export function dueCards(
  ctx: BackendContext,
  project: ProjectId | null,
  at: bigint,
  limit = 100,
  newCards = 20
): Card[] {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(newCards) || newCards < 0)
    throw new StudyError('invalid_input', 'invalid card allowance');

  const active = sql`(a.material_id IS NULL OR EXISTS(SELECT 1 FROM materials m WHERE m.id=a.material_id AND m.archived_at IS NULL))`;

  const reviewed = ctx.db.orm
    .all<typeof cards.$inferSelect>(
      sql`SELECT c.* FROM cards c JOIN artifacts a ON a.id=c.artifact_id WHERE ${active} AND (${project} IS NULL OR a.project_id=${project}) AND c.due<=${at} AND c.reps>0 ORDER BY c.due,c.id LIMIT ${limit}`
    )
    .map(cardRow);
  const fresh = ctx.db.orm
    .all<typeof cards.$inferSelect>(
      sql`SELECT * FROM (SELECT c.*,a.project_id FROM cards c JOIN artifacts a ON a.id=c.artifact_id WHERE ${active} AND c.due<=${at} AND c.reps=0 ORDER BY c.due,c.id LIMIT ${newCards}) WHERE (${project} IS NULL OR project_id=${project}) LIMIT ${limit - reviewed.length}`
    )
    .map(cardRow);

  return [...reviewed, ...fresh];
}

import type { dueCardsInputSchema } from '@study/contracts/learning/rpc';
import { and, asc, eq, gt, isNull, lte, or, sql } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { now } from './quiz.ts';

type Input = typeof dueCardsInputSchema.Type & {
  newCardsPerDay: number;
};

export function makeDueCards(resources: StoreResources) {
  const { db, clock } = resources;
  const dueCards = (input: Input) => {
    // Unscheduled cards use a stable zero due value for pagination.
    const due = sql<bigint>`coalesce(${s.material_card_schedules.due}, 0)`.mapWith(
      s.material_card_schedules.due
    );
    const midnight = new Date(clock.currentTimeMillisUnsafe());

    midnight.setHours(0, 0, 0, 0);
    const since = BigInt(Math.floor(midnight.getTime() / 1000));
    const count = db.orm.get<{
      n: bigint;
    }>(
      sql`SELECT count(*) AS n FROM (SELECT min(reviewed_at) AS first FROM material_card_reviews GROUP BY card_id) WHERE first >= ${since}`
    );
    const allowance = Math.max(0, input.newCardsPerDay - Number(count?.n ?? 0));
    const rows = db.orm
      .select({
        snapshot: s.material_flashcard_entries,
        schedule: s.material_card_schedules,
        due
      })
      .from(s.material_flashcard_entries)
      .innerJoin(
        s.material_versions,
        eq(s.material_versions.id, s.material_flashcard_entries.version_id)
      )
      .innerJoin(s.materials, eq(s.materials.id, s.material_versions.material_id))
      .leftJoin(
        s.material_card_schedules,
        eq(s.material_card_schedules.card_id, s.material_flashcard_entries.card_id)
      )
      .where(
        and(
          eq(s.material_versions.project_id, input.projectId),
          eq(s.material_versions.status, 'published'),
          isNull(s.materials.archived_at),
          sql`${s.material_versions.number} = (SELECT max(latest.number) FROM material_versions latest WHERE latest.material_id = ${s.material_versions.material_id} AND latest.status = 'published')`,
          lte(due, input.before ?? now(clock)),
          sql`(${s.material_card_schedules.reps} > 0 OR ${s.material_flashcard_entries.card_id} IN (
          SELECT e.card_id FROM material_flashcard_entries e
          JOIN material_versions v ON v.id = e.version_id
          JOIN materials m ON m.id = v.material_id
          LEFT JOIN material_card_schedules cs ON cs.card_id = e.card_id
          WHERE v.status = 'published' AND m.archived_at IS NULL
            AND v.number = (SELECT max(latest.number) FROM material_versions latest WHERE latest.material_id = v.material_id AND latest.status = 'published')
            AND coalesce(cs.reps, 0) = 0
            AND coalesce(cs.due, 0) <= ${input.before ?? now(clock)}
          ORDER BY coalesce(cs.due, 0), e.card_id LIMIT ${allowance}
        ))`,
          input.cursor
            ? or(
                gt(due, input.cursor.due),
                and(
                  eq(due, input.cursor.due),
                  gt(s.material_flashcard_entries.card_id, input.cursor.cardId)
                )
              )
            : undefined
        )
      )
      .orderBy(asc(due), asc(s.material_flashcard_entries.card_id))
      .limit(input.limit + 1)
      .all();
    const last = rows[input.limit - 1];

    return {
      items: rows.slice(0, input.limit),
      nextCursor:
        rows.length > input.limit && last
          ? {
              due: last.due,
              cardId: last.snapshot.card_id
            }
          : null
    };
  };

  return {
    dueCards
  };
}

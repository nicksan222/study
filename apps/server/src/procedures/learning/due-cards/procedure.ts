import * as s from '@study/db/schema';
import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import { now } from '#server/procedures/learning/quiz';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    // Unscheduled cards use a stable zero due value for pagination.
    const due = sql<bigint>`coalesce(${s.material_card_schedules.due}, 0)`.mapWith(
      s.material_card_schedules.due
    );
    const rows = ctx.store.db.orm
      .select({ snapshot: s.material_flashcard_entries, schedule: s.material_card_schedules, due })
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
          lte(due, input.before ?? now()),
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
      .limit(input.take + 1)
      .all();
    const last = rows[input.take - 1];

    return {
      items: rows.slice(0, input.take),
      nextCursor:
        rows.length > input.take && last ? { due: last.due, cardId: last.snapshot.card_id } : null
    };
  });

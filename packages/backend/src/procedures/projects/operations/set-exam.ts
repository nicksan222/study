import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { ProjectId } from '#backend/shared/ids';

import { now } from './common.ts';

export function setExam(ctx: BackendContext, id: ProjectId, day: string | null): boolean {
  if (day !== null) {
    const parsed = z.iso
      .date()
      .safeParse(
        day.replace(
          /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/,
          (_, year: string, month: string, date: string) =>
            `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${date.padStart(2, '0')}`
        )
      );

    if (!parsed.success)
      throw new StudyError('invalid_input', 'invalid exam date', {
        cause: parsed.error
      });

    day = parsed.data;
  }

  return (
    ctx.db.orm
      .update(schema.projects)
      .set({ exam_on: day, updated_at: now() })
      .where(sql`id = ${id}`)
      .run().changes !== 0n
  );
}

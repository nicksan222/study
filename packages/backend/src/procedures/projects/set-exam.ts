import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { ProjectId } from '#backend/shared/ids';

import { now } from './projects.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput,
      examOn: z.string().nullable().default(null)
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: setExam(store, r.id, r.examOn)
    };
  });

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
      .set({
        exam_on: day,
        updated_at: now()
      })
      .where(sql`id = ${id}`)
      .run().changes !== 0n
  );
}

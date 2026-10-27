import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { JobId } from '#backend/shared/ids';
import type { Job } from '#backend/shared/jobs/types';

import { rowJob } from './worker.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;
    const found = job(store, r.id);

    return {
      value: found ? found : null
    };
  });

export function job(ctx: BackendContext, id: JobId): Job | null {
  const row = ctx.db.orm
    .select()
    .from(schema.jobs)
    .where(sql`id = ${id}`)
    .get();

  return row ? rowJob(row) : null;
}

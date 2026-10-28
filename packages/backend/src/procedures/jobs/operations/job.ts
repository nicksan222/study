import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { rowJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import type { JobId } from '#backend/shared/ids';

export function job(ctx: BackendContext, id: JobId): ReturnType<typeof rowJob> | null {
  const row = ctx.db.orm
    .select()
    .from(schema.jobs)
    .where(sql`id = ${id}`)
    .get();

  return row ? rowJob(row) : null;
}

import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { rowJob } from '#server/procedures/jobs/worker';
import type { ServerContext } from '#server/runtime/context';
import type { JobId } from '#server/shared/ids';

export function job(ctx: ServerContext, id: JobId): ReturnType<typeof rowJob> | null {
  const row = ctx.db.orm
    .select()
    .from(schema.jobs)
    .where(sql`id = ${id}`)
    .get();

  return row ? rowJob(row) : null;
}

import * as schema from '@study/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

import { now, reconcileJobs } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import type { JobId } from '#backend/shared/ids';

export function cancelJob(ctx: BackendContext, id: JobId): boolean {
  return ctx.transaction(() => {
    const changed =
      ctx.db.orm
        .update(schema.jobs)
        .set({
          status: 'cancelled',
          waiting_for: null,
          updated_at: now(),
          finished_at: now()
        })
        .where(
          and(
            eq(schema.jobs.id, id),
            inArray(schema.jobs.status, ['blocked', 'queued', 'waiting', 'running'])
          )
        )
        .run().changes !== 0n;

    if (changed) reconcileJobs(ctx);

    return changed;
  });
}

import { and, eq, inArray } from '@study/db';
import * as schema from '@study/db/schema';

import { now, reconcileJobs } from '#server/procedures/jobs/worker';
import type { ServerContext } from '#server/runtime/context';
import type { JobId } from '#server/shared/ids';

export function cancelJob(ctx: ServerContext, id: JobId): boolean {
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

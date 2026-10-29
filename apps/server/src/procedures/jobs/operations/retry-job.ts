import { eq, sql } from '@study/db';
import * as schema from '@study/db/schema';

import { job } from '#server/procedures/jobs/operations/job';
import { now } from '#server/procedures/jobs/worker';
import type { ServerContext } from '#server/runtime/context';
import type { JobId } from '#server/shared/ids';

export function retryJob(ctx: ServerContext, id: JobId): boolean {
  return ctx.transaction(() => {
    const value = job(ctx, id);

    if (!value || (value.status !== 'failed' && value.status !== 'cancelled')) return false;

    if (
      value.kind === 'extract' &&
      value.target.type === 'source' &&
      value.status === 'cancelled' &&
      ctx.db.orm
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(sql`source_id=${value.target.id} AND json_extract(meta, '$.corrected')=1`)
        .get()
    )
      return false;

    const twin = ctx.db.orm
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        sql`dedupe_key=(SELECT dedupe_key FROM jobs WHERE id=${id}) AND status IN ('queued','blocked','waiting','running')`
      )
      .get();

    if (twin) return false;

    const started = ctx.db.orm.get(
      sql`SELECT 1 FROM job_deps d JOIN jobs j ON j.id=d.job_id WHERE d.depends_on=${id} AND (j.status='running' OR j.attempts>0) LIMIT 1`
    );

    if (started) return false;

    ctx.db.orm
      .update(schema.jobs)
      .set({ status: 'blocked', updated_at: now() })
      .where(sql`status='queued' AND id IN (SELECT job_id FROM job_deps WHERE depends_on=${id})`)
      .run();

    ctx.db.orm
      .update(schema.jobs)
      .set({
        status: sql`CASE WHEN EXISTS (SELECT 1 FROM job_deps d JOIN jobs j ON j.id=d.depends_on WHERE d.job_id=jobs.id AND j.status IN ('blocked','queued','waiting','running')) THEN 'blocked' ELSE 'queued' END`,
        waiting_for: null,
        run_after: 0n,
        error_kind: null,
        error: null,
        finished_at: null,
        updated_at: now()
      })
      .where(eq(schema.jobs.id, id))
      .run();

    return true;
  });
}

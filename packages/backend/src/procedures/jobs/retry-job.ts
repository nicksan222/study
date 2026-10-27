import * as schema from '@study/db/schema';
import { sql, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { JobId } from '#backend/shared/ids';

import { job as opJob } from './job.ts';
import { now } from './worker.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const value = retryJob(store, r.id);

    wake();

    return {
      value
    };
  });

export function retryJob(ctx: BackendContext, id: JobId): boolean {
  return ctx.transaction(() => {
    const job = opJob(ctx, id);

    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return false;

    if (
      job.kind === 'extract' &&
      job.target.type === 'source' &&
      job.status === 'cancelled' &&
      ctx.db.orm
        .select({
          id: schema.documents.id
        })
        .from(schema.documents)
        .where(sql`source_id=${job.target.id} AND json_extract(meta, '$.corrected')=1`)
        .get()
    )
      return false;

    const twin = ctx.db.orm
      .select({
        id: schema.jobs.id
      })
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
      .set({
        status: 'blocked',
        updated_at: now()
      })
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

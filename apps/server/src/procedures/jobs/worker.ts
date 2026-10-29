import { sql, eq, and, inArray, lte } from '@study/db';
import * as schema from '@study/db/schema';
import { Schema } from 'effect';

import { job as opJob } from '#server/procedures/jobs/operations/job';
import type { ServerContext } from '#server/runtime/context';
import { requireRow } from '#server/shared/errors/index';
import type { Failure } from '#server/shared/errors/index';
import { StudyError } from '#server/shared/errors/index';
import type { JobId } from '#server/shared/ids';
import type { NewJob, Job } from '#server/shared/jobs/types';
import type { JobKind, JobTarget } from '#server/shared/jobs/types';

export function enqueueJob(ctx: ServerContext, input: NewJob): JobId {
  const args = input.args === undefined ? null : JSON.stringify(input.args);
  const key = `${input.kind}:${input.target.type}:${input.target.id}:${args ?? ''}`;

  return ctx.transaction(() => {
    const old = ctx.db.orm
      .select({
        id: schema.jobs.id
      })
      .from(schema.jobs)
      .where(sql`dedupe_key = ${key} AND status IN ('queued','blocked','waiting','running')`)
      .get();
    const id = old
      ? (old.id as JobId)
      : (ctx.db.orm
          .insert(schema.jobs)
          .values({
            kind: input.kind,
            [`${input.target.type}_id`]: input.target.id,
            args,
            dedupe_key: key,
            status: 'queued',
            created_at: now(),
            updated_at: now()
          })
          .run().lastInsertRowid as JobId);
    const after = new Set(input.after ?? []);

    if (input.kind === 'extract' && input.target.type === 'source') {
      for (const fetch of ctx.db.orm
        .select({
          id: schema.jobs.id
        })
        .from(schema.jobs)
        .where(
          sql`kind='fetch' AND source_id=${input.target.id} AND status IN ('blocked','queued','waiting','running')`
        )
        .all())
        after.add(fetch.id as JobId);
    }

    if (old && opJob(ctx, id)?.status === 'running' && after.size > 0)
      throw new StudyError('invalid_input', 'cannot add dependencies to running work');

    for (const dep of after) {
      if (!opJob(ctx, dep)) throw new StudyError('not_found', 'dependency not found');

      if (dep === id) throw new StudyError('invalid_input', 'job cannot depend on itself');

      const cycle = ctx.db.orm.get(
        sql`WITH RECURSIVE ancestors(id) AS (SELECT depends_on FROM job_deps WHERE job_id = ${dep} UNION SELECT d.depends_on FROM job_deps d JOIN ancestors a ON d.job_id = a.id) SELECT 1 AS found FROM ancestors WHERE id = ${id}`
      );

      if (cycle) throw new StudyError('invalid_input', 'job dependency cycle');

      ctx.db.orm.run(
        sql`INSERT OR IGNORE INTO job_deps (job_id,depends_on) SELECT ${id},id FROM jobs WHERE id = ${dep}`
      );
    }

    if (input.kind === 'extract' && input.target.type === 'source') {
      const cycle = ctx.db.orm.get(sql`WITH RECURSIVE ancestors(id) AS (
          SELECT depends_on FROM job_deps WHERE job_id=${id}
          UNION SELECT d.depends_on FROM job_deps d JOIN ancestors a ON d.job_id=a.id
        ) SELECT 1 FROM ancestors a JOIN job_deps d ON d.job_id=a.id
          JOIN jobs f ON f.id=d.depends_on JOIN jobs consumer ON consumer.id=a.id
          WHERE f.kind='fetch' AND f.source_id=${input.target.id}
          AND f.status IN ('blocked','queued','waiting','running')
          AND consumer.status IN ('blocked','queued','waiting') LIMIT 1`);

      if (cycle) throw new StudyError('invalid_input', 'job dependency cycle');

      // A fetch discovers the reader only after receiving bytes. Keep every consumer
      // behind the newly queued extraction in the same transaction as that handoff.
      ctx.db.orm.run(sql`INSERT OR IGNORE INTO job_deps (job_id,depends_on)
          SELECT d.job_id,${id} FROM job_deps d JOIN jobs f ON f.id=d.depends_on
          JOIN jobs consumer ON consumer.id=d.job_id
          WHERE f.kind='fetch' AND f.source_id=${input.target.id}
          AND f.status IN ('blocked','queued','waiting','running') AND d.job_id!=${id}
          AND consumer.status IN ('blocked','queued','waiting')`);
    }

    ctx.db.orm
      .update(schema.jobs)
      .set({
        status: 'blocked',
        updated_at: now()
      })
      .where(
        sql`id=${id} AND status='queued' AND EXISTS (SELECT 1 FROM job_deps d JOIN jobs j ON j.id=d.depends_on WHERE d.job_id=${id} AND j.status IN ('blocked','queued','waiting','running'))`
      )
      .run();

    return id;
  });
}

export function claimJob(ctx: ServerContext, kindsToClaim: JobKind[]): Job | null {
  if (!kindsToClaim.length) return null;

  return ctx.transaction(() => {
    const row = ctx.db.orm
      .select({
        id: schema.jobs.id
      })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.status, 'queued'),
          lte(schema.jobs.run_after, now()),
          inArray(schema.jobs.kind, kindsToClaim)
        )
      )
      .orderBy(schema.jobs.id)
      .limit(1)
      .get();

    if (!row) return null;

    const id = row.id;

    ctx.db.orm
      .update(schema.jobs)
      .set({
        status: 'running',
        attempts: sql`attempts+1`,
        started_at: now(),
        updated_at: now(),
        finished_at: null
      })
      .where(sql`id=${id}`)
      .run();

    return opJob(ctx, id);
  });
}

export function reconcileJobs(ctx: ServerContext): void {
  ctx.db.orm
    .update(schema.jobs)
    .set({
      status: 'queued',
      updated_at: now()
    })
    .where(
      sql`status='blocked' AND NOT EXISTS (SELECT 1 FROM job_deps d JOIN jobs j ON j.id=d.depends_on WHERE d.job_id=jobs.id AND j.status IN ('blocked','queued','waiting','running'))`
    )
    .run();
}

export function finishJob(ctx: ServerContext, id: JobId, attempt: bigint): boolean {
  return ctx.transaction(() => {
    const changed =
      ctx.db.orm
        .update(schema.jobs)
        .set({
          status: 'succeeded',
          updated_at: now(),
          finished_at: now(),
          error: null,
          error_kind: null
        })
        .where(
          sql`id=${id} AND attempts=${attempt} AND status='running' AND kind NOT IN ('reply','rewrite','artifact','question','grade')`
        )
        .run().changes !== 0n;

    if (changed) {
      reconcileJobs(ctx);
    }

    return changed;
  });
}

export function failJob(ctx: ServerContext, id: JobId, attempt: bigint, failure: Failure): boolean {
  return ctx.transaction(() => {
    const waiting = ['auth', 'config', 'model_unavailable'].includes(failure.kind);

    if (
      (failure.kind === 'transient' || failure.kind === 'rate_limited') &&
      failure.retryAfterMs !== null
    ) {
      if (!Number.isFinite(failure.retryAfterMs) || failure.retryAfterMs < 0)
        throw new StudyError('invalid_input', 'invalid retry delay');

      const changed =
        ctx.db.orm
          .update(schema.jobs)
          .set({
            status: 'queued',
            run_after: now() + BigInt(Math.ceil(failure.retryAfterMs / 1000)),
            error_kind: failure.kind,
            error: failure.message,
            updated_at: now()
          })
          .where(sql`id=${id} AND attempts=${attempt} AND status='running'`)
          .run().changes !== 0n;

      return changed;
    }

    const changed =
      ctx.db.orm
        .update(schema.jobs)
        .set({
          status: waiting ? 'waiting' : 'failed',
          waiting_for: waiting ? 'language_models' : null,
          error_kind: failure.kind,
          error: failure.message,
          updated_at: now(),
          finished_at: waiting ? null : now()
        })
        .where(sql`id=${id} AND attempts=${attempt} AND status='running'`)
        .run().changes !== 0n;

    if (changed) {
      if (!waiting) reconcileJobs(ctx);
    }

    return changed;
  });
}

export function releaseWaiting(ctx: ServerContext): number {
  return ctx.transaction(() =>
    Number(
      ctx.db.orm
        .update(schema.jobs)
        .set({
          status: sql`CASE WHEN EXISTS (SELECT 1 FROM job_deps d JOIN jobs j ON j.id=d.depends_on WHERE d.job_id=jobs.id AND j.status IN ('blocked','queued','waiting','running')) THEN 'blocked' ELSE 'queued' END`,
          waiting_for: null,
          updated_at: now()
        })
        .where(sql`status='waiting' AND waiting_for='language_models'`)
        .run().changes
    )
  );
}

export function recoverJobs(ctx: ServerContext): number {
  return ctx.transaction(() =>
    Number(
      ctx.db.orm
        .update(schema.jobs)
        .set({
          status: 'queued',
          updated_at: now()
        })
        .where(eq(schema.jobs.status, 'running'))
        .run().changes
    )
  );
}

export function now(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function rowJob(row: typeof schema.jobs.$inferSelect) {
  const type = requireRow(
    (['source', 'document', 'session', 'message', 'artifact', 'question'] as const).find(
      (t) => row[`${t}_id`] !== null
    )
  );

  return {
    id: row.id,
    kind: row.kind,
    target: {
      type,
      id: row[`${type}_id`]
    } as JobTarget,
    status: row.status,
    args:
      row.args === null ? null : Schema.decodeUnknownSync(Schema.MutableJson)(JSON.parse(row.args)),
    attempts: row.attempts,
    errorKind: row.error_kind,
    error: row.error,
    runAfter: row.run_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

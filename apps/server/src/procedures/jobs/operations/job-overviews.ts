import { desc, eq } from '@study/db';
import * as schema from '@study/db/schema';

import { rowJob } from '#server/procedures/jobs/worker';
import type { ServerContext } from '#server/runtime/context';

export function listJobs(ctx: ServerContext): ReturnType<typeof rowJob>[] {
  return ctx.db.orm.select().from(schema.jobs).orderBy(schema.jobs.id).all().map(rowJob);
}

export function targetJobs(
  ctx: ServerContext,
  type: ReturnType<typeof rowJob>['target']['type'],
  id: bigint
): ReturnType<typeof rowJob>[] {
  const column = {
    source: schema.jobs.source_id,
    document: schema.jobs.document_id,
    session: schema.jobs.session_id,
    message: schema.jobs.message_id,
    artifact: schema.jobs.artifact_id,
    question: schema.jobs.question_id
  }[type];

  return ctx.db.orm
    .select()
    .from(schema.jobs)
    .where(eq(column, id))
    .orderBy(desc(schema.jobs.id))
    .all()
    .map(rowJob);
}

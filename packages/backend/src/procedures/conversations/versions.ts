import { sql } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { VersionId, JobId } from '#backend/shared/ids';
import type { Citation } from '#backend/shared/sources/citations';

import { writeCitations as opWriteCitations } from './operations/edit-message.ts';
import { now, normalizeText } from './operations/post-message.ts';

export function beginVersion(
  ctx: BackendContext,
  version: VersionId,
  jobId: JobId,
  attempt: bigint
): boolean {
  return ctx.transaction(() => {
    const row = ctx.db.orm.get<Record<string, unknown>>(
      sql`SELECT v.message_id FROM message_versions v JOIN jobs j ON j.id=${jobId} AND j.message_id=v.message_id WHERE v.id=${version} AND v.status IN ('pending','writing') AND j.status='running' AND j.attempts=${attempt} AND j.kind IN ('reply','rewrite') AND json_extract(j.args, '$.versionId') = CAST(v.id AS TEXT) AND (v.status='pending' OR v.owner_job_id IS NULL OR v.owner_job_id=${jobId} AND v.owner_attempt<${attempt})`
    );

    if (!row) return false;

    ctx.db.orm.run(
      sql`UPDATE message_versions SET status='writing',owner_job_id=${jobId},owner_attempt=${attempt} WHERE id=${version}`
    );

    return true;
  });
}

export function finishVersion(
  ctx: BackendContext,
  version: VersionId,
  jobId: JobId,
  attempt: bigint,
  text: string,
  citations: readonly Citation[] = []
): boolean {
  return ctx.transaction(() => {
    const row = ctx.db.orm.get<Record<string, unknown>>(
      sql`SELECT v.message_id,v.based_on FROM message_versions v JOIN jobs j ON j.id=v.owner_job_id AND j.message_id=v.message_id WHERE v.id=${version} AND v.status='writing' AND v.owner_job_id=${jobId} AND v.owner_attempt=${attempt} AND j.status='running' AND j.attempts=${attempt}`
    );

    if (!row) return false;

    text = normalizeText(text);
    opWriteCitations(ctx, version, citations);
    ctx.db.orm.run(
      sql`UPDATE message_versions SET status='complete',text=${text} WHERE id=${version}`
    );
    ctx.db.orm.run(
      sql`UPDATE messages SET active_version_id=${version} WHERE id=${row.message_id as bigint} AND active_version_id IS ${row.based_on as bigint | null}`
    );
    ctx.db.orm.run(
      sql`UPDATE jobs SET status='succeeded',updated_at=${now()},finished_at=${now()},error=NULL,error_kind=NULL WHERE id=${jobId}`
    );

    return true;
  });
}

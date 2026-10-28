import * as schema from '@study/db/schema';
import { sql, desc } from 'drizzle-orm';

import { enqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId, ProjectId, ArtifactId, JobId } from '#backend/shared/ids';
import type { ArtifactKind } from '#backend/shared/study/types';

import { now } from './artifact.ts';

export function requestMaterial(
  ctx: BackendContext,
  projectId: ProjectId,
  kind: ArtifactKind,
  title: string,
  sources: SourceId[]
): {
  artifactId: ArtifactId;
  jobId: JobId;
} {
  if (!['flashcards', 'diagram'].includes(kind) || !title.trim() || [...title.trim()].length > 200)
    throw new StudyError('invalid_input', 'invalid material');

  return ctx.transaction(() => {
    const existing = ctx.db.orm
      .select({
        id: schema.artifacts.id
      })
      .from(schema.artifacts)
      .where(sql`project_id=${projectId} AND kind=${kind} AND mistakes=0 AND status!='complete'`)
      .get();

    if (existing) {
      const oldId = existing.id as ArtifactId;
      const job = ctx.db.orm
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status
        })
        .from(schema.jobs)
        .where(sql`artifact_id=${oldId} AND kind='artifact'`)
        .orderBy(desc(schema.jobs.id))
        .limit(1)
        .get();

      if (job && ['blocked', 'queued', 'waiting', 'running'].includes(job.status as string))
        return {
          artifactId: oldId,
          jobId: job.id as JobId
        };

      ctx.db.orm
        .delete(schema.artifacts)
        .where(sql`id=${oldId}`)
        .run();
    }

    const previous = ctx.db.orm
      .select({ materialId: schema.artifacts.material_id })
      .from(schema.artifacts)
      .where(sql`project_id=${projectId} AND kind=${kind} AND mistakes=0 AND status='complete'`)
      .get();
    const at = now();
    const artifactId = ctx.db.orm
      .insert(schema.artifacts)
      .values({
        project_id: projectId,
        material_id: previous?.materialId ?? null,
        kind: kind,
        title: title.trim(),
        status: 'pending',
        created_at: at,
        updated_at: at
      })
      .run().lastInsertRowid as ArtifactId;

    ctx.db.orm.run(
      sql`INSERT INTO artifact_note_snapshots (artifact_id,message_id,version_id) SELECT ${artifactId},m.id,m.active_version_id FROM messages m JOIN sessions s ON s.id=m.session_id WHERE s.project_id=${projectId} AND m.role='user' AND m.active_version_id IS NOT NULL`
    );

    for (const source of sources)
      ctx.db.orm
        .insert(schema.artifact_sources)
        .values({
          artifact_id: artifactId,
          source_id: source
        })
        .run();

    const after: JobId[] = [];

    for (const source of sources)
      for (const row of ctx.db.orm
        .select({
          id: schema.jobs.id
        })
        .from(schema.jobs)
        .where(
          sql`source_id=${source} AND kind IN ('fetch','extract') AND status IN ('blocked','queued','waiting','running')`
        )
        .all())
        after.push(row.id as JobId);

    const jobId = enqueueJob(ctx, {
      kind: 'artifact',
      target: {
        type: 'artifact',
        id: artifactId
      },
      after
    });

    return {
      artifactId,
      jobId
    };
  });
}

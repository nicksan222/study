import * as schema from '@study/db/schema';
import { text } from '@study/localization';
import { sql, desc } from 'drizzle-orm';
import { z } from 'zod';

import { listSessions as opListSessions } from '#backend/procedures/conversations/all-sessions';
import { listMessages as opListMessages } from '#backend/procedures/conversations/messages';
import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import { project as opProject } from '#backend/procedures/projects/projects';
import { language } from '#backend/procedures/settings/get-app-settings';
import { listSources as opListSources } from '#backend/procedures/sources/sources';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';
import type { ProjectId } from '#backend/shared/ids';
import type { ArtifactId, JobId } from '#backend/shared/ids';
import type { ArtifactKind } from '#backend/shared/study/types';

import { now } from './artifact.ts';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput,
      kind: z.enum(['flashcards', 'diagram'])
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const project = r.project;
    const materialKind = r.kind;
    const sources = opListSources(store)
      .filter((s) => s.projectId === project)
      .map((s) => s.id);

    if (!opProject(store, project)) throw new StudyError('not_found', 'Project missing');

    const notes = opListSessions(store, project)
      .flatMap((s) => opListMessages(store, s.id))
      .some((m) => m.versions.some((v) => v.id === m.activeVersionId && v.text.trim()));

    if (!sources.length && !notes) throw new StudyError('not_enough', 'No study content');

    const result = requestMaterial(
      store,
      project,
      materialKind,
      text(language(store), materialKind === 'flashcards' ? 'KindFlashcards' : 'KindDiagram'),
      sources
    );

    wake();

    return {
      id: result.artifactId
    };
  });

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

    const jobId = opEnqueueJob(ctx, {
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

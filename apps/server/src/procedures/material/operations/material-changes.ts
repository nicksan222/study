import { sql } from '@study/db';
import * as schema from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import type { ArtifactId, SourceId } from '#server/shared/ids';

import { artifact as opArtifact } from './artifact.ts';

export function materialChanges(
  ctx: ServerContext,
  id: ArtifactId
): { files: number; notes: number } | null {
  const artifact = opArtifact(ctx, id);

  if (!artifact) return null;

  const currentSources = ctx.db.orm
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(sql`project_id=${artifact.projectId}`)
    .all()
    .map((row) => row.id as SourceId);
  const saved = ctx.db.orm
    .select({ source_id: schema.artifact_sources.source_id })
    .from(schema.artifact_sources)
    .where(sql`artifact_id=${id}`)
    .all()
    .map((row) => row.source_id as SourceId | null);
  const current = new Set(currentSources);
  const previous = new Set(saved.filter((value): value is SourceId => value !== null));
  const files =
    currentSources.filter((value) => !previous.has(value)).length +
    saved.filter((value) => value === null || !current.has(value)).length;
  const before = ctx.db.orm
    .select({
      message_id: schema.artifact_note_snapshots.message_id,
      version_id: schema.artifact_note_snapshots.version_id
    })
    .from(schema.artifact_note_snapshots)
    .where(sql`artifact_id=${id}`)
    .all()
    .map((row) => `${row.message_id}:${row.version_id}`);
  const after = ctx.db.orm
    .all(
      sql`SELECT m.id,m.active_version_id FROM messages m JOIN sessions s ON s.id=m.session_id WHERE s.project_id=${artifact.projectId} AND m.role='user' AND m.active_version_id IS NOT NULL`
    )
    .map((row) => `${row.id}:${row.active_version_id}`);
  const old = new Set(before);
  const latest = new Set(after);
  const notes =
    before.filter((value) => !latest.has(value)).length +
    after.filter((value) => !old.has(value)).length;

  return { files, notes };
}

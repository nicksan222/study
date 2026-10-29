import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { targetJobs } from '#server/procedures/jobs/operations/job-overviews';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { ArtifactId } from '#server/shared/ids';
import type { Anchor } from '#server/shared/sources/document';
import type { MemoryState } from '#server/shared/study/srs';
import type { ArtifactBody, Card } from '#server/shared/study/types';

export function artifact(ctx: ServerContext, id: ArtifactId) {
  const r = ctx.db.orm
    .select()
    .from(schema.artifacts)
    .where(sql`id=${id}`)
    .get();

  if (!r) return null;

  const citations = ctx.db.orm
    .select()
    .from(schema.artifact_citations)
    .where(sql`artifact_id=${id}`)
    .orderBy(schema.artifact_citations.marker)
    .all()
    .map((c) => ({
      marker: Number(c.marker),
      sourceId: c.source_id,
      sourceName: c.source_name,
      anchor: JSON.parse(c.anchor) as Anchor,
      quote: c.quote
    }));

  return {
    id,
    projectId: r.project_id,
    materialId: r.material_id,
    kind: r.kind,
    title: r.title,
    status: r.status,
    body: r.body === null ? null : (JSON.parse(r.body) as ArtifactBody),
    citations,
    sources: ctx.db.orm
      .select({ source_id: schema.artifact_sources.source_id })
      .from(schema.artifact_sources)
      .where(sql`artifact_id=${id}`)
      .orderBy(sql`rowid`)
      .all()
      .map((row) => row.source_id),
    mistakes: r.mistakes === 1n,
    practiceId: r.practice_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function cards(ctx: ServerContext, id: ArtifactId): Card[] {
  return ctx.db.orm
    .select()
    .from(schema.cards)
    .where(sql`artifact_id=${id}`)
    .orderBy(schema.cards.ordinal)
    .all()
    .map(cardRow);
}

export const now = () => BigInt(Math.floor(Date.now() / 1000));

export function cardRow(r: typeof schema.cards.$inferSelect) {
  return {
    id: r.id,
    artifactId: r.artifact_id,
    ...(r.material_card_id === null ? {} : { materialCardId: r.material_card_id }),
    ordinal: r.ordinal,
    front: r.front,
    back: r.back,
    cites: JSON.parse(r.cites) as number[],
    memory: {
      stability: r.stability,
      difficulty: r.difficulty,
      reps: Number(r.reps),
      lapses: Number(r.lapses),
      lastReview: r.last_review,
      due: r.due,
      state: Number(r.state) as MemoryState,
      elapsedDays: Number(r.elapsed_days),
      scheduledDays: Number(r.scheduled_days),
      learningSteps: Number(r.learning_steps)
    }
  };
}

export function text(value: string): string {
  const result = value.trim();

  if (!result) throw new StudyError('invalid_input', 'card text is empty');

  return result;
}

export function artifactView(ctx: ServerContext, value: NonNullable<ReturnType<typeof artifact>>) {
  return { ...value, job: targetJobs(ctx, 'artifact', value.id)[0] ?? null };
}

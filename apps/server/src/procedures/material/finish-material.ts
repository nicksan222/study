import { sql } from '@study/db';
import * as schema from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { JobId } from '#server/shared/ids';
import type { ArtifactId } from '#server/shared/ids';
import { validateCitations } from '#server/shared/sources/citations';
import type { ArtifactBody } from '#server/shared/study/types';

import type { CanonicalCitationInput } from './canonical.ts';
import { canonicalEvidence, writeCanonicalVersion, syncCanonicalArtifact } from './canonical.ts';
import { now, text, artifact as opArtifact, cards as opCards } from './operations/artifact.ts';

export function finishMaterial(
  ctx: ServerContext,
  id: ArtifactId,
  job: JobId,
  attempt: bigint,
  body: ArtifactBody,
  citations: CanonicalCitationInput[]
): boolean {
  return ctx.transaction(() => {
    const artifact = opArtifact(ctx, id);
    const running = ctx.db.orm
      .select({
        id: schema.jobs.id
      })
      .from(schema.jobs)
      .where(
        sql`id=${job} AND artifact_id=${id} AND kind='artifact' AND status='running' AND attempts=${attempt}`
      )
      .get();

    if (!artifact || !running || artifact.status === 'complete') return false;

    validateCitations(citations);

    if (body.type !== artifact.kind) throw new StudyError('invalid_input', 'wrong material body');

    if (body.type === 'flashcards') {
      body = {
        type: 'flashcards',
        cards: body.cards.map((card) => ({
          front: text(card.front),
          back: text(card.back),
          cites: card.cites
        }))
      };
    } else {
      body = {
        type: 'diagram',
        mermaid: text(body.mermaid)
      };
    }

    if (body.type === 'flashcards')
      for (const card of body.cards) {
        text(card.front);
        text(card.back);
      }
    else text(body.mermaid);

    const old = ctx.db.orm
      .select({
        id: schema.artifacts.id
      })
      .from(schema.artifacts)
      .where(
        sql`project_id=${artifact.projectId} AND kind=${artifact.kind} AND mistakes=0 AND status='complete'`
      )
      .get()?.id as ArtifactId | undefined;

    if (body.type === 'flashcards') {
      const available = old ? opCards(ctx, old) : [];

      body.cards.forEach((entry, ordinal) => {
        const match = available.findIndex(
          (c) => c.front === entry.front.trim() && c.back === entry.back.trim()
        );

        if (match >= 0) {
          const previous = available.splice(match, 1)[0];

          ctx.db.orm
            .update(schema.cards)
            .set({
              artifact_id: id,
              ordinal: BigInt(ordinal),
              cites: JSON.stringify(entry.cites)
            })
            .where(sql`id=${previous.id}`)
            .run();
        } else
          ctx.db.orm
            .insert(schema.cards)
            .values({
              artifact_id: id,
              ordinal: BigInt(ordinal),
              front: text(entry.front),
              back: text(entry.back),
              cites: JSON.stringify(entry.cites),
              due: now()
            })
            .run();
      });
    }

    const content =
      body.type === 'diagram'
        ? { kind: 'diagram' as const, format: 'mermaid' as const, payload: body.mermaid }
        : {
            kind: 'flashcards' as const,
            cards: opCards(ctx, id).map((card) => ({
              front: card.front,
              back: card.back,
              ...(card.materialCardId === undefined ? {} : { cardId: card.materialCardId })
            }))
          };
    const version = writeCanonicalVersion(ctx, {
      projectId: artifact.projectId,
      materialId: artifact.materialId ?? (old ? opArtifact(ctx, old)?.materialId : null),
      title: artifact.title,
      content,
      creator: 'agent',
      operation: 'generate',
      evidence: canonicalEvidence(ctx, artifact.projectId, artifact.sources, citations)
    });

    ctx.db.orm
      .update(schema.artifacts)
      .set({ material_id: version.material_id })
      .where(sql`id=${id}`)
      .run();

    if (version.kind === 'flashcards') {
      const projected = opCards(ctx, id);

      version.content.cards.forEach((card, index) => {
        const projection = projected[index];

        if (projection)
          ctx.db.orm
            .update(schema.cards)
            .set({ material_card_id: card.cardId })
            .where(sql`id=${projection.id}`)
            .run();
      });
    }

    if (old)
      ctx.db.orm
        .delete(schema.artifacts)
        .where(sql`id=${old}`)
        .run();

    for (const c of citations)
      ctx.db.orm
        .insert(schema.artifact_citations)
        .values({
          artifact_id: id,
          marker: BigInt(c.marker),
          source_id: sql`(SELECT id FROM sources WHERE id=${c.sourceId})`,
          source_name: c.sourceName,
          anchor: JSON.stringify(c.anchor),
          quote: c.quote
        })
        .run();

    ctx.db.orm
      .update(schema.artifacts)
      .set({
        status: 'complete',
        body: JSON.stringify(body),
        updated_at: now()
      })
      .where(sql`id=${id}`)
      .run();
    ctx.db.orm
      .update(schema.jobs)
      .set({
        status: 'succeeded',
        updated_at: now(),
        finished_at: now()
      })
      .where(sql`id=${job}`)
      .run();

    return true;
  });
}

export function invalidateMaterial(ctx: ServerContext, id: ArtifactId): void {
  ctx.db.orm
    .delete(schema.artifacts)
    .where(
      sql`status!='complete' AND mistakes=0 AND project_id=(SELECT project_id FROM artifacts WHERE id=${id}) AND kind=(SELECT kind FROM artifacts WHERE id=${id} AND mistakes=0)`
    )
    .run();
}

export function syncMaterialBody(ctx: ServerContext, id: ArtifactId): void {
  const cards = opCards(ctx, id).map((card) => ({
    front: card.front,
    back: card.back,
    cites: card.cites
  }));

  ctx.db.orm
    .update(schema.artifacts)
    .set({
      body: JSON.stringify({
        type: 'flashcards',
        cards
      }),
      updated_at: now()
    })
    .where(sql`id=${id} AND kind='flashcards' AND status='complete'`)
    .run();
  syncCanonicalArtifact(ctx, id);
}

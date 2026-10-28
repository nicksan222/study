import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { syncCanonicalArtifact } from '#backend/procedures/material/canonical';
import { invalidateMaterial, syncMaterialBody } from '#backend/procedures/material/finish-material';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { ArtifactId, CardId } from '#backend/shared/ids';

import { artifact as opArtifact, now, text } from './artifact.ts';

export function updateCard(ctx: BackendContext, id: CardId, front: string, back: string): boolean {
  return ctx.transaction(() => {
    front = text(front);
    back = text(back);
    const row = ctx.db.orm
      .select({ artifact_id: schema.cards.artifact_id })
      .from(schema.cards)
      .where(sql`id=${id}`)
      .get();

    if (!row) return false;

    invalidateMaterial(ctx, row.artifact_id as ArtifactId);
    ctx.db.orm
      .update(schema.cards)
      .set({ front, back })
      .where(sql`id=${id}`)
      .run();
    syncMaterialBody(ctx, row.artifact_id as ArtifactId);

    return true;
  });
}

export function deleteCard(ctx: BackendContext, id: CardId): boolean {
  return ctx.transaction(() => {
    const row = ctx.db.orm
      .select({ artifact_id: schema.cards.artifact_id })
      .from(schema.cards)
      .where(sql`id=${id}`)
      .get();

    if (!row) return false;

    invalidateMaterial(ctx, row.artifact_id as ArtifactId);
    ctx.db.orm
      .delete(schema.cards)
      .where(sql`id=${id}`)
      .run();
    syncMaterialBody(ctx, row.artifact_id as ArtifactId);

    return true;
  });
}

export function renameArtifact(ctx: BackendContext, id: ArtifactId, title: string): boolean {
  const value = text(title);

  if ([...value].length > 200) throw new StudyError('invalid_input', 'title is too long');

  return ctx.transaction(() => {
    const artifact = opArtifact(ctx, id);

    if (!artifact) return false;

    if (artifact.status === 'complete') invalidateMaterial(ctx, id);

    ctx.db.orm
      .update(schema.artifacts)
      .set({ title: value, updated_at: now() })
      .where(sql`id=${id}`)
      .run();

    if (artifact.materialId !== null)
      ctx.db.orm
        .update(schema.materials)
        .set({ title: value, updated_at: now() })
        .where(sql`id=${artifact.materialId}`)
        .run();

    return true;
  });
}

export function updateDiagram(ctx: BackendContext, id: ArtifactId, mermaid: string): boolean {
  return ctx.transaction(() => {
    const artifact = opArtifact(ctx, id);

    if (!artifact) return false;

    if (artifact.kind !== 'diagram' || artifact.status !== 'complete')
      throw new StudyError('invalid_input', 'not a complete diagram');

    invalidateMaterial(ctx, id);
    ctx.db.orm
      .update(schema.artifacts)
      .set({ body: JSON.stringify({ type: 'diagram', mermaid: text(mermaid) }), updated_at: now() })
      .where(sql`id=${id}`)
      .run();

    syncCanonicalArtifact(ctx, id);

    return true;
  });
}

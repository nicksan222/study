import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { CardId } from '#backend/shared/ids';
import type { ArtifactId } from '#backend/shared/ids';

import { now, text, artifact as opArtifact, cards as opCards } from './artifact.ts';
import { syncCanonicalArtifact } from './canonical.ts';
import {
  invalidateMaterial as opInvalidateMaterial,
  syncMaterialBody as opSyncMaterialBody
} from './finish-material.ts';

export const run = publicProcedure
  .input(
    z.object({
      artifact: idInput,
      index: z.number().int().min(0).max(1000000),
      change: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('write'),
          front: z.string(),
          back: z.string()
        }),
        z.object({
          type: z.literal('delete')
        })
      ])
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;
    const cards = opCards(store, r.artifact);
    const index = r.index;
    const card = cards[index];

    if (!card)
      return {
        value: false
      };

    if (r.change.type === 'write')
      return {
        value: updateCard(store, card.id, r.change.front, r.change.back)
      };

    if (r.change.type === 'delete')
      return {
        value: deleteCard(store, card.id)
      };

    return invalid('Card change required');
  });

export function updateCard(ctx: BackendContext, id: CardId, front: string, back: string): boolean {
  return ctx.transaction(() => {
    front = text(front);
    back = text(back);
    const row = ctx.db.orm
      .select({
        artifact_id: schema.cards.artifact_id
      })
      .from(schema.cards)
      .where(sql`id=${id}`)
      .get();

    if (!row) return false;

    opInvalidateMaterial(ctx, row.artifact_id as ArtifactId);
    ctx.db.orm
      .update(schema.cards)
      .set({
        front: front,
        back: back
      })
      .where(sql`id=${id}`)
      .run();
    opSyncMaterialBody(ctx, row.artifact_id as ArtifactId);

    return true;
  });
}

export function deleteCard(ctx: BackendContext, id: CardId): boolean {
  return ctx.transaction(() => {
    const row = ctx.db.orm
      .select({
        artifact_id: schema.cards.artifact_id
      })
      .from(schema.cards)
      .where(sql`id=${id}`)
      .get();

    if (!row) return false;

    opInvalidateMaterial(ctx, row.artifact_id as ArtifactId);
    ctx.db.orm
      .delete(schema.cards)
      .where(sql`id=${id}`)
      .run();
    opSyncMaterialBody(ctx, row.artifact_id as ArtifactId);

    return true;
  });
}

export function renameArtifact(ctx: BackendContext, id: ArtifactId, title: string): boolean {
  const value = text(title);

  if ([...value].length > 200) throw new StudyError('invalid_input', 'title is too long');

  return ctx.transaction(() => {
    const artifact = opArtifact(ctx, id);

    if (!artifact) return false;

    if (artifact.status === 'complete') opInvalidateMaterial(ctx, id);

    ctx.db.orm
      .update(schema.artifacts)
      .set({
        title: value,
        updated_at: now()
      })
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

    opInvalidateMaterial(ctx, id);
    ctx.db.orm
      .update(schema.artifacts)
      .set({
        body: JSON.stringify({
          type: 'diagram',
          mermaid: text(mermaid)
        }),
        updated_at: now()
      })
      .where(sql`id=${id}`)
      .run();

    syncCanonicalArtifact(ctx, id);

    return true;
  });
}

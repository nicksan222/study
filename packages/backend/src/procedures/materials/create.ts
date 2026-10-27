import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { MaterialDetail } from '#backend/shared/materials/types';

import { attachMaterial } from './attach.ts';
import { readMaterial, required } from './reads.ts';
import { createMaterialSchema, documentSchema } from './schemas.ts';
import { materialTransaction } from './transactions.ts';
import { assertProject, assertSession, insertVersion, now } from './writes.ts';

export const run = publicProcedure
  .input(createMaterialSchema)
  .mutation(({ ctx, input }) => createMaterial(ctx.store, input));

export function createMaterial(
  store: BackendContext,
  input: z.input<typeof createMaterialSchema>
): MaterialDetail {
  return materialTransaction(store, () => insertMaterial(store, createMaterialSchema.parse(input)));
}

function insertMaterial(
  store: BackendContext,
  input: z.infer<typeof createMaterialSchema>,
  documentId?: bigint
): MaterialDetail {
  assertProject(store, input.projectId);

  if (input.sessionId !== undefined) assertSession(store, input.sessionId, input.projectId);

  const timestamp = now();
  const row = store.db.orm
    .insert(s.materials)
    .values({
      project_id: input.projectId,
      kind: input.content.kind,
      title: input.title,
      created_at: timestamp,
      updated_at: timestamp
    })
    .returning()
    .get();

  insertVersion(store, row.id, input, documentId);

  if (input.sessionId !== undefined) attachMaterial(store, input.sessionId, row.id);

  return required(readMaterial(store, row.id));
}

export function createMaterialFromDocument(
  store: BackendContext,
  input: Omit<z.input<typeof createMaterialSchema>, 'content'> & { documentId: bigint }
): MaterialDetail {
  return materialTransaction(store, () => {
    const doc = required(
      store.db.orm.select().from(s.documents).where(eq(s.documents.id, input.documentId)).get()
    );

    if (doc.source_id !== null) {
      const source = required(
        store.db.orm.select().from(s.sources).where(eq(s.sources.id, doc.source_id)).get()
      );

      if (source.project_id !== input.projectId)
        throw new StudyError('invalid_input', 'Document belongs to another project');
    }

    const blocks = store.db.orm
      .select()
      .from(s.blocks)
      .where(eq(s.blocks.document_id, doc.id))
      .all()
      .map((b) => ({ kind: b.kind, text: b.text, anchor: JSON.parse(b.anchor) }));
    const document = documentSchema.parse({ blocks, meta: JSON.parse(doc.meta) });
    const parsed = createMaterialSchema.parse({
      ...input,
      content: { kind: 'document', ...document }
    });

    return insertMaterial(store, parsed, doc.id);
  });
}

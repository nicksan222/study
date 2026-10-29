import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { readMaterial, required } from '#server/procedures/materials/reads';
import { createMaterialSchema, documentSchema } from '#server/procedures/materials/schemas';
import { materialTransaction } from '#server/procedures/materials/transactions';
import {
  assertProject,
  assertSession,
  insertVersion,
  now
} from '#server/procedures/materials/writes';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { createMaterialInputSchema } from '#server/shared/materials/schemas';
import type { MaterialDetailDto } from '#server/shared/materials/schemas';

import { attachMaterial } from './session-membership.ts';

type CreateMaterialInput = typeof createMaterialInputSchema.Type;

export function createMaterial(
  store: ServerContext,
  input: CreateMaterialInput
): MaterialDetailDto {
  return materialTransaction(store, () => insertMaterial(store, createMaterialSchema.parse(input)));
}

function insertMaterial(
  store: ServerContext,
  input: CreateMaterialInput,
  documentId?: bigint
): MaterialDetailDto {
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
  store: ServerContext,
  input: Omit<CreateMaterialInput, 'content'> & { documentId: bigint }
): MaterialDetailDto {
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

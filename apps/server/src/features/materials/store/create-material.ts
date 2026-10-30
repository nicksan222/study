import { StudyError } from '@study/contracts/errors';
import type { DocumentId } from '@study/contracts/ids';
import type { MaterialDetailDto } from '@study/contracts/materials/schemas';
import { createMaterialInputSchema } from '@study/contracts/materials/schemas';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { required, makeReads } from '#server/features/materials/store/reads';
import { documentSchema } from '#server/features/materials/store/schemas';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { now, makeWrites } from '#server/features/materials/store/writes';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeSessionMembership } from './session-membership.ts';

type CreateMaterialInput = typeof createMaterialInputSchema.Type;

export function makeCreateMaterial(resources: StoreResources) {
  const { db, clock } = resources;
  const store = db;
  const { readMaterial } = makeReads(resources);
  const { assertProject, assertSession, insertVersion } = makeWrites(resources);
  const { attachMaterial } = makeSessionMembership(resources);

  function createMaterial(input: CreateMaterialInput): MaterialDetailDto {
    return materialIntegrity(() =>
      insertMaterial(Schema.decodeUnknownSync(createMaterialInputSchema)(input))
    );
  }

  function insertMaterial(input: CreateMaterialInput, documentId?: DocumentId): MaterialDetailDto {
    assertProject(input.projectId);

    if (input.sessionId !== undefined) assertSession(input.sessionId, input.projectId);

    const timestamp = now(clock);
    const row = store.orm
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

    insertVersion(row.id, input, documentId);

    if (input.sessionId !== undefined) attachMaterial(input.sessionId, row.id);

    return required(readMaterial(row.id));
  }

  function createMaterialFromDocument(
    input: Omit<CreateMaterialInput, 'content'> & {
      documentId: DocumentId;
    }
  ): MaterialDetailDto {
    return materialIntegrity(() => {
      const doc = required(
        store.orm.select().from(s.documents).where(eq(s.documents.id, input.documentId)).get()
      );

      if (doc.source_id !== null) {
        const source = required(
          store.orm.select().from(s.sources).where(eq(s.sources.id, doc.source_id)).get()
        );

        if (source.project_id !== input.projectId)
          throw new StudyError('invalid_input', 'Document belongs to another project');
      }

      const blocks = store.orm
        .select()
        .from(s.blocks)
        .where(eq(s.blocks.document_id, doc.id))
        .all()
        .map((b) => ({
          kind: b.kind,
          text: b.text,
          anchor: JSON.parse(b.anchor)
        }));
      const document = Schema.decodeUnknownSync(documentSchema)({
        blocks,
        meta: JSON.parse(doc.meta)
      });
      const parsed = Schema.decodeUnknownSync(createMaterialInputSchema)({
        ...input,
        content: {
          kind: 'document',
          ...document
        }
      });

      return insertMaterial(parsed, doc.id);
    });
  }

  return {
    createMaterial,
    createMaterialFromDocument
  };
}

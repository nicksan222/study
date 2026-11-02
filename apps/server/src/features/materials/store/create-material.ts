/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Inserts the material record and its initial version into the database.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Inserts the base material row before associated version records are written.           │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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
    if (input.projectId !== undefined) assertProject(input.projectId);

    if (input.sessionId !== undefined) assertSession(input.sessionId);

    const timestamp = now(clock);
    const row = store.orm
      .insert(s.materials)
      .values({
        kind: input.content.kind,
        title: input.title,
        created_at: timestamp,
        updated_at: timestamp
      })
      .returning()
      .get();

    if (input.projectId !== undefined)
      store.orm
        .insert(s.project_materials)
        .values({ project_id: input.projectId, material_id: row.id })
        .run();

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

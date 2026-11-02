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

import type { MaterialDetailDto } from '@study/contracts/materials/schemas';
import { createMaterialInputSchema } from '@study/contracts/materials/schemas';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { required, makeReads } from '#server/features/materials/store/reads';
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

  function createMaterial(
    input: CreateMaterialInput,
    creator: 'user' | 'import' = 'user'
  ): MaterialDetailDto {
    return materialIntegrity(() =>
      insertMaterial(Schema.decodeUnknownSync(createMaterialInputSchema)(input), creator)
    );
  }

  function insertMaterial(
    input: CreateMaterialInput,
    creator: 'user' | 'import'
  ): MaterialDetailDto {
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

    insertVersion(row.id, input, creator === 'import' ? { documentId: null } : undefined);

    if (input.sessionId !== undefined) attachMaterial(input.sessionId, row.id);

    return required(readMaterial(row.id));
  }

  return { createMaterial };
}

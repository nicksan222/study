/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds canonical Document revision readers and publication participants.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Shares exact revision, citation and publication operations within Materials.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Materials owns persistence; callers compose synchronous transactions.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { MaterialId, MaterialVersionId } from '@study/contracts/ids';
import { and, eq, desc } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeCitations } from './citations.ts';
import { makeCreateMaterial } from './create-material.ts';
import { makeReads, required } from './reads.ts';
import { makeSetCitationsAction } from './set-citations-action.ts';
import { makeWrites } from './writes.ts';

export function makeDocumentRevisions(resources: StoreResources) {
  const { db } = resources;

  const reads = makeReads(resources);

  const { insertVersion, publish } = makeWrites(resources);

  const { createMaterial } = makeCreateMaterial(resources);

  const { readCitations } = makeCitations(resources);

  const { setCitations } = makeSetCitationsAction(resources);

  function documentVersion(id: MaterialVersionId) {
    const version = required(reads.readVersion(id));

    if (version.kind !== 'document') throw new StudyError('invalid_input', 'Document required');

    return version;
  }

  function head(materialId: MaterialId) {
    reads.materialRow(materialId, true);

    return required(
      db.orm
        .select()
        .from(s.material_versions)
        .where(
          and(
            eq(s.material_versions.material_id, materialId),
            eq(s.material_versions.status, 'published')
          )
        )
        .orderBy(desc(s.material_versions.number))
        .get()
    );
  }

  return {
    reads,
    insertVersion,
    publish,
    createMaterial,
    readCitations,
    setCitations,
    documentVersion,
    head
  };
}

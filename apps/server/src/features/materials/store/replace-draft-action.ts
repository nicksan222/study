/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Replaces the content of an existing unpublished material draft.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Replaces draft payloads while preserving published version records.                    │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { replaceDraftInputSchema } from '@study/contracts/materials/rpc';

type Input = typeof replaceDraftInputSchema.Type;

import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads, required } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { makeWrites, now } from '#server/features/materials/store/writes';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeContent } from './content.ts';

export function makeReplaceDraftAction(resources: StoreResources) {
  const { db: store, clock } = resources;
  const { readVersion, versionRow } = makeReads(resources);
  const { insertContent, removeContent } = makeContent(resources);
  const { insertLinks } = makeWrites(resources);
  const replaceDraft = (input: Input) =>
    materialIntegrity(() => {
      const version = versionRow(input.id, true),
        db = store.orm;

      if (version.kind !== input.content.kind)
        throw new StudyError('invalid_input', 'Version kind must match material');

      db.delete(s.material_evidence_citations)
        .where(eq(s.material_evidence_citations.version_id, version.id))
        .run();
      db.delete(s.material_evidence_inputs)
        .where(eq(s.material_evidence_inputs.version_id, version.id))
        .run();
      db.delete(s.material_version_parents)
        .where(eq(s.material_version_parents.version_id, version.id))
        .run();
      removeContent(version.id);
      insertLinks(version, input);
      insertContent(version, input.content);
      db.update(s.material_versions)
        .set({
          operation: input.operation ?? version.operation,
          language: input.language === undefined ? version.language : input.language
        })
        .where(eq(s.material_versions.id, version.id))
        .run();
      db.update(s.materials)
        .set({ updated_at: now(clock) })
        .where(eq(s.materials.id, version.material_id))
        .run();

      return required(readVersion(version.id));
    });

  return { replaceDraft };
}

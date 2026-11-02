/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists and reads citations that bind generated content to source-version         │
 * │ excerpts.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Resolves citation markers to source version and block references.                      │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialVersionId } from '@study/contracts/ids';
import { asc, eq } from '@study/db';
import * as s from '@study/db/schema';

import { makeReads, required } from '#server/features/materials/store/reads';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { readCitation } from './citation-row.ts';
import { makeSupport } from './citation-support.ts';
import { makeEvidence } from './evidence.ts';

export function makeCitations(
  resources: StoreResources,
  readDocument?: ReturnType<typeof makeReads>['readCanonicalDocument']
) {
  const { db } = resources;
  const store = db;
  const { versionRow } = makeReads(resources);
  const support = makeSupport(resources, readDocument);
  const evidence = makeEvidence(resources, readDocument);

  function readCitationDetails(row: typeof s.material_version_citations.$inferSelect) {
    const citation = readCitation(row);
    const reference =
      citation.target === undefined
        ? {
            kind: 'anchor' as const,
            versionId: citation.inputVersionId,
            anchor: citation.anchor,
            quote: citation.quote
          }
        : {
            kind: 'range' as const,
            target: {
              materialId: required(
                db.orm
                  .select({ materialId: s.material_versions.material_id })
                  .from(s.material_versions)
                  .where(eq(s.material_versions.id, citation.inputVersionId))
                  .get()
              ).materialId,
              range: citation.target
            }
          };

    const resolved = evidence.resolve(reference);

    return {
      ...citation,
      precision: resolved.precision,
      support: support.support({ versionId: row.version_id, marker: row.marker }),
      evidence: resolved
    };
  }

  function readCitations(id: MaterialVersionId) {
    versionRow(id);

    return store.orm
      .select()
      .from(s.material_version_citations)
      .where(eq(s.material_version_citations.version_id, id))
      .orderBy(asc(s.material_version_citations.marker))
      .all()
      .map(readCitationDetails);
  }

  return {
    readCitations,
    readCitationDetails
  };
}

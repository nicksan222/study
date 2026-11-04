/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds shared authored editing operations for generation and proposal publication.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Composes exact reads, evidence validation, immutable revisions and guarded edits.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private factories share caller-owned store resources without opening transactions or     │
 * │ publishing events.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDocumentEditing } from './editing.ts';
import { makeDocumentEvidence } from './provenance.ts';
import { makeDocumentReads } from './reads.ts';
import { makeDocumentRevisions } from './revisions.ts';

export function makeDocumentPublication(resources: StoreResources) {
  return {
    reads: makeDocumentReads(resources),
    revisions: makeDocumentRevisions(resources),
    evidence: makeDocumentEvidence(resources),
    editing: makeDocumentEditing(resources)
  };
}

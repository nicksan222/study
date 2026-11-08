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

import { makePageEditing } from './editing.ts';
import { makePageEvidence } from './provenance.ts';
import { makePageReads } from './reads.ts';
import { makePageRevisions } from './revisions.ts';

export function makePagePublication(resources: StoreResources) {
  return {
    reads: makePageReads(resources),
    revisions: makePageRevisions(resources),
    evidence: makePageEvidence(resources),
    editing: makePageEditing(resources)
  };
}

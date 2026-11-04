/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds exact learning citation reads and writes to retained input persistence.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Binds exact learning citation reads and writes to retained input persistence.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside its feature; callers own transaction scope. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeExactInputs } from './exact-inputs.ts';

/** Learning citations retain typed exact owners without projecting them into Materials. */
export function makeCitations(resources: StoreResources) {
  const exact = makeExactInputs(resources);

  return { readCitations: exact.citations, readCitationDetails: exact.citationValue };
}

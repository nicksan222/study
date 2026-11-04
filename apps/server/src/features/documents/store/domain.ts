/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes private authored persistence for synchronous caller-owned Document        │
 * │ transactions.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Composes private authored persistence for synchronous caller-owned Document            │
 * │   transactions.                                                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Documents ownership; callers own            │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDocumentEditing } from './editing.ts';
import { makeDocumentGeneration } from './generation.ts';
import { makeDocumentHistory } from './history.ts';
import { makeDocumentProposals } from './proposals.ts';
import { makeDocumentReads } from './reads.ts';

export function makeDocumentDomain(resources: StoreResources) {
  const reads = makeDocumentReads(resources);
  const editing = makeDocumentEditing(resources);
  const history = makeDocumentHistory(resources);
  const generation = makeDocumentGeneration(resources);
  const proposals = makeDocumentProposals(resources);

  return { ...reads, ...editing, ...history, ...generation, ...proposals };
}

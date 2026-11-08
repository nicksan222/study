/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes private authored persistence for synchronous caller-owned Page            │
 * │ transactions.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Composes private authored persistence for synchronous caller-owned Page                │
 * │   transactions.                                                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makePageEditing } from './editing.ts';
import { makePageGeneration } from './generation.ts';
import { makePageHistory } from './history.ts';
import { makePageProposals } from './proposals.ts';
import { makePageReads } from './reads.ts';

export function makePageDomain(resources: StoreResources) {
  const reads = makePageReads(resources);
  const editing = makePageEditing(resources);
  const history = makePageHistory(resources);
  const generation = makePageGeneration(resources);
  const proposals = makePageProposals(resources);

  return { ...reads, ...editing, ...history, ...generation, ...proposals };
}

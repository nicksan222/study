/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes synchronous Learning participants for exact Material history cleanup.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Delegates inspection and cleanup to this feature’s canonical history store.            │
 * │ - Shares the caller transaction without exporting private persistence capabilities.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Materials coordinates policy through the public service; this feature owns its writes.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { historyVersionIdsSchema } from '@study/contracts/materials/history';

import { LearningMaterialHistoryStore } from '#server/features/learning/store/material-history';
import type { Transaction } from '#server/platform/definitions/define-store';

export function prepareMaterialHistory(tx: Transaction, ids: typeof historyVersionIdsSchema.Type) {
  return tx.store(LearningMaterialHistoryStore).prepare(ids);
}

export function scrubMaterialHistory(tx: Transaction, ids: typeof historyVersionIdsSchema.Type) {
  tx.store(LearningMaterialHistoryStore).scrub(ids);
}

export function inspectMaterialHistory(tx: Transaction, ids: typeof historyVersionIdsSchema.Type) {
  return tx.store(LearningMaterialHistoryStore).learningMaterialHistory(ids);
}

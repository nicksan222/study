/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Material deletion owns exact scope, barriers and content retirement; native        │
 * │ Workflow owns execution.                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
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

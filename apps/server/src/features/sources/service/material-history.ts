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

import { SourceMaterialHistoryStore } from '#server/features/sources/store/material-history';
import type { Transaction } from '#server/platform/definitions/define-store';
export function inspectMaterialHistory(tx: Transaction, ids: typeof historyVersionIdsSchema.Type) {
  return tx.store(SourceMaterialHistoryStore).sourceMaterialHistory(ids);
}
export function prepareMaterialHistory(
  tx: Transaction,
  input: { operationId: string; versionIds: typeof historyVersionIdsSchema.Type }
) {
  return tx.store(SourceMaterialHistoryStore).prepare(input);
}
export function scrubMaterialHistory(tx: Transaction, operationId: string) {
  tx.store(SourceMaterialHistoryStore).scrub({ operationId });
}

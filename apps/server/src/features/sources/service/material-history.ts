/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes synchronous Sources participants for exact Material history cleanup.       │
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

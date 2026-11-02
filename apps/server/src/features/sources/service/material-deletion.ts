/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Public synchronous participants retain feature ownership during Material cleanup.  │
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

import type { MaterialId, SourceId } from '@study/contracts/ids';

import {
  SourceMaterialDeletionStore,
  SourceMaterialImpactStore
} from '#server/features/sources/store/material-deletion';
import type { Transaction } from '#server/platform/definitions/define-store';

export function prepareMaterialDeletion(tx: Transaction, id: MaterialId) {
  return tx.store(SourceMaterialDeletionStore).prepare(id);
}

export function scrubMaterialDeletion(tx: Transaction, id: MaterialId) {
  tx.store(SourceMaterialDeletionStore).scrub(id);
}

export function inspectMaterialDeletion(tx: Transaction, ids: readonly SourceId[]) {
  return tx.store(SourceMaterialImpactStore).sourceMaterialImpact(ids);
}

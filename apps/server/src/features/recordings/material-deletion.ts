/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Public participants preserve recording ownership during Material retirement.       │
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

import type { Transaction } from '#server/platform/definitions/define-store';

import {
  RecordingMaterialImpactStore,
  RecordingMaterialDeletionStore
} from './store/material-deletion.ts';
export function inspectMaterialDeletion(tx: Transaction, ids: readonly SourceId[]) {
  return tx.store(RecordingMaterialImpactStore).recordingMaterialImpact(ids);
}
export function scrubMaterialDeletion(tx: Transaction, id: MaterialId) {
  tx.store(RecordingMaterialDeletionStore).scrub(id);
}

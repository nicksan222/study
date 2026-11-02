/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Public transaction participants keep learning persistence behind its owning        │
 * │ feature.                                                                                 │
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

import type { MaterialId } from '@study/contracts/ids';

import type { Transaction } from '#server/platform/definitions/define-store';

import { LearningMaterialDeletionStore } from './store/material-deletion.ts';

export function prepareMaterialDeletion(tx: Transaction, ids: readonly MaterialId[]) {
  return tx.store(LearningMaterialDeletionStore).prepare(ids);
}

export function scrubMaterialDeletion(tx: Transaction, ids: readonly MaterialId[]) {
  tx.store(LearningMaterialDeletionStore).scrub(ids);
}

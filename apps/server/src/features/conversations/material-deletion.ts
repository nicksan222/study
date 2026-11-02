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

import type { Transaction } from '#server/platform/definitions/define-store';

import {
  ConversationMaterialDeletionStore,
  ConversationMaterialImpactStore
} from './store/material-deletion.ts';
export function prepareMaterialDeletion(
  tx: Transaction,
  input: {
    deletionId: MaterialId;
    materialIds: readonly MaterialId[];
    sourceIds: readonly SourceId[];
  }
) {
  return tx.store(ConversationMaterialDeletionStore).prepare(input);
}
export function scrubMaterialDeletion(tx: Transaction, id: MaterialId) {
  tx.store(ConversationMaterialDeletionStore).scrub(id);
}

export function inspectMaterialDeletion(
  tx: Transaction,
  input: { materialIds: readonly MaterialId[]; sourceIds: readonly SourceId[] }
) {
  return tx.store(ConversationMaterialImpactStore).conversationMaterialImpact(input);
}

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Archives a material through the transaction-safe store action.                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Composes archive state changes with their transaction and publication effects.         │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { archiveInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof archiveInputSchema.Type;

import { makeArchiveMaterial } from '#server/features/materials/store/archive-material';

export function makeArchiveAction(resources: StoreResources) {
  const { setArchived } = makeArchiveMaterial(resources);
  const archive = (input: Input) => setArchived(input.id, true);

  return {
    archive
  };
}

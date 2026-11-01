/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Restores an archived material to the active project list.                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Restores archived material visibility within its project.                              │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { unarchiveInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof unarchiveInputSchema.Type;

import { makeArchiveMaterial } from '#server/features/materials/store/archive-material';

export function makeUnarchiveAction(resources: StoreResources) {
  const { setArchived } = makeArchiveMaterial(resources);
  const unarchive = (input: Input) => setArchived(input.id, false);

  return { unarchive };
}

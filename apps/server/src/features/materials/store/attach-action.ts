/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Attaches a material to a project using the store’s transaction boundary.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates project ownership while creating a material attachment.                      │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { attachInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof attachInputSchema.Type;

import { makeNoteMembership } from '#server/features/materials/store/note-membership';

export function makeAttachAction(resources: StoreResources) {
  const { attachMaterialTransaction } = makeNoteMembership(resources);
  const attach = (input: Input) => {
    attachMaterialTransaction(input.noteId, input.materialId);

    return input;
  };

  return {
    attach
  };
}

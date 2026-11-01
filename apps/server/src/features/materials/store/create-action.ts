/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Creates a material and its initial version through a composed store action.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Composes initial material creation with its first version transaction.                 │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { createInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof createInputSchema.Type;

import { makeCreateMaterial } from '#server/features/materials/store/create-material';

export function makeCreateAction(resources: StoreResources) {
  const { createMaterial } = makeCreateMaterial(resources);
  const create = (input: Input) => createMaterial(input);

  return {
    create
  };
}

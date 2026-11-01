/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Loads a material detail record through the typed store query path.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Returns material details through the store query schema.                               │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { materialInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof materialInputSchema.Type;

import { makeReads } from '#server/features/materials/store/reads';

export function makeGetAction(resources: StoreResources) {
  const { readMaterial } = makeReads(resources);
  const get = (input: Input) => readMaterial(input.id);

  return { get };
}

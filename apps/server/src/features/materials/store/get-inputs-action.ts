/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Loads the source versions recorded as inputs to a material version.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Returns captured input version identifiers for generation and citation checks.         │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { inputsInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeLinkedVersions } from './linked-versions.ts';

export function makeGetInputsAction(resources: StoreResources) {
  const linkedVersions = makeLinkedVersions(resources);

  return { getInputs: (input: typeof inputsInputSchema.Type) => linkedVersions(input, 'inputs') };
}

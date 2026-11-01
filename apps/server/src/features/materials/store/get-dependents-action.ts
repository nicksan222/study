/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Finds material versions that depend on a given version.                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Finds downstream versions for dependency-aware mutation checks.                        │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { dependentsInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeLinkedVersions } from './linked-versions.ts';

export function makeGetDependentsAction(resources: StoreResources) {
  const linkedVersions = makeLinkedVersions(resources);

  return {
    getDependents: (input: typeof dependentsInputSchema.Type) => linkedVersions(input, 'dependents')
  };
}

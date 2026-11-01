/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Loads a material version with its persisted content and links.                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Loads content and link metadata for a specific immutable version.                      │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { materialVersionInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof materialVersionInputSchema.Type;

import { makeReads } from '#server/features/materials/store/reads';

export function makeGetVersionAction(resources: StoreResources) {
  const { readVersion } = makeReads(resources);
  const getVersion = (input: Input) => readVersion(input.id);

  return { getVersion };
}

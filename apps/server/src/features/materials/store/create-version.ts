/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Creates a new material version with its validated input and parent links.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks version kind and links before inserting the draft version.                      │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { createVersionInputSchema } from '@study/contracts';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof createVersionInputSchema.Type;

import { makeReads, required } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { makeWrites } from '#server/features/materials/store/writes';

export function makeCreateVersion(resources: StoreResources) {
  const { readVersion } = makeReads(resources);
  const { insertVersion } = makeWrites(resources);
  const createVersion = (input: Input) =>
    materialIntegrity(() => required(readVersion(insertVersion(input.materialId, input))));

  return {
    createVersion
  };
}

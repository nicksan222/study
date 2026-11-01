/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Publishes a draft material version and updates its material’s current version.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Moves a validated draft into published state and updates the current pointer.          │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { publishVersionInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof publishVersionInputSchema.Type;

import { makeReads, required } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { makeWrites } from '#server/features/materials/store/writes';

export function makePublishVersionAction(resources: StoreResources) {
  const { readVersion } = makeReads(resources);
  const { publish } = makeWrites(resources);
  const publishVersion = (input: Input) =>
    materialIntegrity(() => {
      publish(input.id);

      return required(readVersion(input.id));
    });

  return { publishVersion };
}

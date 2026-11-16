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

import type { createInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import type { StoreResources } from '@study/server';

type Input = typeof createInputSchema.Type;

import { makeCreateMaterial } from '#server/features/materials/store/create-material';

export function makeCreate(resources: StoreResources) {
  const { createMaterial } = makeCreateMaterial(resources);
  const create = (input: Input) => {
    if ('sourceId' in input.content)
      throw new StudyError(
        'invalid_input',
        'Source acquisition already registers its library material'
      );

    return createMaterial(input);
  };

  return {
    create
  };
}

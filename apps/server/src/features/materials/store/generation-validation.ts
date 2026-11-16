/** @file Owns generation validation within this feature. */

import { StudyError } from '@study/contracts';
import type { StoreResources } from '@study/server';

import { makeGenerationQueries } from './generation-queries.ts';

export function makeGenerationValidation(resources: StoreResources) {
  const { readGeneration } = makeGenerationQueries(resources);

  function validateInputs(request: NonNullable<ReturnType<typeof readGeneration>>) {
    if (!request.inputs.length)
      throw new StudyError('invalid_input', 'Generation input capture is unavailable');
  }

  function assertNotCancelled(request: { id: string; cancelled: boolean }) {
    if (request.cancelled) throw new StudyError('cancelled', 'Generation was cancelled');
  }

  return { assertNotCancelled, validateInputs };
}

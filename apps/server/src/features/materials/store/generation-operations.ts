/** @file Owns generation operations within this feature. */

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeGenerationPublication } from './generation-publication.ts';
import { makeGenerationQueries } from './generation-queries.ts';
import { makeGenerationRequests } from './generation-requests.ts';
import { makeGenerationScope } from './generation-scope.ts';

export function makeGeneration(resources: StoreResources) {
  const { activeGenerations, cancelGeneration } = makeGenerationQueries(resources);
  const { setGenerationScope } = makeGenerationScope(resources);
  const {
    generationContext,
    prepareGenerationRetry,
    prepareGenerationFailure,
    requestGeneration,
    requestGenerationOnce
  } = makeGenerationRequests(resources);
  const { publishGeneration } = makeGenerationPublication(resources);

  return {
    activeGenerations,
    cancelGeneration,
    generationContext,
    prepareGenerationRetry,
    prepareGenerationFailure,
    publishGeneration,
    requestGeneration,
    requestGenerationOnce,
    setGenerationScope
  };
}

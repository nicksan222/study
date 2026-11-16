/** @file Owns system within this feature. */

import type { materialSearchInputSchema, searchInputSchema } from '@study/contracts';
import { Effect } from 'effect';

import { HealthStore, SystemStore } from '#server/features/system/store/index';
import { useStore } from '#server/platform/definitions/define-store';
import { WorkerLifecycle } from '#server/platform/workflows/lifecycle';

import { healthData } from './health.ts';

export function* systemOperations() {
  const workers = yield* WorkerLifecycle;

  const store = yield* useStore(SystemStore);

  const health = yield* useStore(HealthStore);

  return {
    health: () =>
      health.health(undefined).pipe(
        Effect.flatMap(() => workers.started),
        Effect.map(healthData)
      ),
    materialSearch: (input: typeof materialSearchInputSchema.Type) =>
      store.searches({ ...input, kinds: ['material'] }).pipe(
        Effect.map((hits) => ({
          hits: hits.flatMap((hit) =>
            hit.target.type === 'material'
              ? [{ ...hit, kind: 'material' as const, target: hit.target }]
              : []
          )
        }))
      ),
    search: (input: typeof searchInputSchema.Type) =>
      store.searches(input).pipe(Effect.map((hits) => ({ hits }))),
    startWorkers: () => workers.start,
    stopWorkers: () => workers.stop
  };
}

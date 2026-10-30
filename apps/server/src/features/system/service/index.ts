import type { searchInputSchema } from '@study/contracts/system/rpc';
import { Effect } from 'effect';

import { HealthStore, SystemStore } from '#server/features/system/store/index';
import { defineService } from '#server/platform/definitions/define-service';
import { useStore } from '#server/platform/definitions/define-store';
import { WorkerLifecycle } from '#server/platform/workflows/lifecycle';

import { healthData } from './health.ts';

export const System = defineService(
  'study/System',
  Effect.gen(function* () {
    const workers = yield* WorkerLifecycle;
    const store = yield* useStore(SystemStore);
    const health = yield* useStore(HealthStore);

    return {
      health: () =>
        health.health(undefined).pipe(
          Effect.flatMap(() => workers.started),
          Effect.map(healthData)
        ),
      search: (input: typeof searchInputSchema.Type) =>
        store.searches(input).pipe(Effect.map((hits) => ({ semantic: false, hits }))),
      startWorkers: () => workers.start,
      stopWorkers: () => workers.stop
    };
  })
);

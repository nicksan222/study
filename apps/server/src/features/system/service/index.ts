import type { searchInputSchema } from '@study/contracts/system/rpc';
import { Effect } from 'effect';

import { HealthStore, SystemStore } from '#server/features/system/store/index';
import { Database } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import { WorkerLifecycle } from '#server/platform/workflows/lifecycle';

import { healthData } from './health.ts';

export const System = defineService(
  'study/System',
  Effect.gen(function* () {
    const { store: context } = yield* Database;
    const workers = yield* WorkerLifecycle;
    const store = SystemStore.make(context);
    const health = HealthStore.make(context);

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

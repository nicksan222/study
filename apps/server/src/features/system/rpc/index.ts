import type { StudyError } from '@study/contracts/errors';
import { SystemRpc } from '@study/contracts/system/rpc';
import { Effect } from 'effect';

import { System } from '#server/features/system/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const SystemRpcLive = SystemRpc.toLayer(
  Effect.gen(function* () {
    const system = yield* System;

    return {
      'system.health': () => system.health().pipe(Effect.mapError(failure)),
      'system.search': (input) => system.search(input).pipe(Effect.mapError(failure)),
      'system.startWorkers': () => system.startWorkers().pipe(Effect.mapError(failure)),
      'system.stopWorkers': () => system.stopWorkers().pipe(Effect.mapError(failure))
    };
  })
);

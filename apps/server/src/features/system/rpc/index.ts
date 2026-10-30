import { SystemRpc } from '@study/contracts/system/rpc';
import { Effect } from 'effect';

import { System } from '#server/features/system/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const SystemRpcLive = defineRpc(
  SystemRpc,
  Effect.gen(function* () {
    const system = yield* System;

    return {
      'system.health': () => system.health(),
      'system.search': (input) => system.search(input),
      'system.startWorkers': () => system.startWorkers(),
      'system.stopWorkers': () => system.stopWorkers()
    };
  })
);

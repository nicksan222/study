import { StudyRpc } from '@study/contracts/rpc';
import { makeStudyClient } from '@study/server/client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Effect, Exit, Scope } from 'effect';

const scope = Scope.makeUnsafe();

const client = Effect.runPromise(
  makeStudyClient(StudyRpc, {
    baseUrl: async () => {
      if (isTauri()) {
        const connection = await invoke<{ baseUrl: string }>('server_connection');

        return connection.baseUrl;
      }

      return window.location.origin;
    }
  }).pipe(Effect.provideService(Scope.Scope, scope))
);

type Client = Awaited<typeof client>;

export function runStudy<A, E>(
  operation: (client: Client) => Effect.Effect<A, E>,
  signal?: AbortSignal
) {
  return Effect.runPromise(
    Effect.flatMap(
      Effect.promise(() => client),
      operation
    ),
    { signal }
  );
}

import.meta.hot?.dispose(() => {
  void Effect.runPromise(Scope.close(scope, Exit.void));
});

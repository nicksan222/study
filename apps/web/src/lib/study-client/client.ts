import { StudyRpc } from '@study/contracts/rpc';
import { makeStudyClient } from '@study/server/client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Effect } from 'effect';

export const studyClient = makeStudyClient(StudyRpc, {
  baseUrl: async () => {
    if (isTauri()) {
      const connection = await invoke<{ baseUrl: string }>('server_connection');

      return connection.baseUrl;
    }

    return window.location.origin;
  }
});

export type StudyClient = Effect.Success<typeof studyClient>;

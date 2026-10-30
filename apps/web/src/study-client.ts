import { createStudyClient } from '@study/server/client';
import { invoke, isTauri } from '@tauri-apps/api/core';

export const studyClient = createStudyClient({
  baseUrl: async () => {
    if (isTauri()) {
      const connection = await invoke<{ baseUrl: string }>('server_connection');

      return connection.baseUrl;
    }

    return window.location.origin;
  }
});

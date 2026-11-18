import { defineConfig, mergeConfig } from 'vite-plus';

import client from '../client/vite.config.ts';

export default defineConfig(
  mergeConfig(client, { root: Bun.fileURLToPath(new URL('.', import.meta.url)) })
);

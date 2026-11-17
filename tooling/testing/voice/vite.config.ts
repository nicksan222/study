import { testPolicy } from '@study/testing';
import { defineConfig } from 'vite-plus';

/** Explicit native-model integration: existing model paths are required; nothing downloads. */
export default defineConfig({
  root: Bun.fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    name: 'voice-native',
    setupFiles: ['apps/server/test/testing/setup.ts'],
    include: ['tooling/testing/voice/*.integration.ts'],
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: testPolicy.tests.integration
  }
});

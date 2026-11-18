import { testPolicy } from '@study/testing';
import { defineConfig } from 'vite-plus';

/** Native dictation exercises each registered model using explicitly prepared local assets. */
export default defineConfig({
  root: Bun.fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    name: 'voice-native',
    setupFiles: ['apps/server/test/testing/setup.ts'],
    reporters: process.env.CI
      ? ['verbose', ['junit', { outputFile: 'tooling/test-results/vitest/voice.xml' }]]
      : ['verbose'],
    include: ['tooling/testing/voice/native.integration.ts'],
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: testPolicy.tests.integration
  }
});

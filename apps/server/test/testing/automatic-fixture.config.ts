import { testPolicy } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Configures isolated Vitest subprocesses for automatic server fixture scenarios.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Runs real fixture scenarios with per-test SQLite cleanup hooks.                        │
 * │ - Keeps subprocess caches isolated from the parent test runner.                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Selects lazy fixture scenarios without starting the application itself.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { defineConfig } from 'vite-plus';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('../../../../', import.meta.url)),
  test: {
    include: ['apps/server/test/testing/automatic-fixture-scenario.ts'],
    setupFiles: ['apps/server/test/testing/setup.ts'],
    environment: 'node',
    fsModuleCache: false,
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: testPolicy.tests.unit,
    hookTimeout: testPolicy.hookTimeout
  }
});

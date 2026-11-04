/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Configures isolated Vitest subprocesses for automatic server fixture scenarios.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Runs real fixture scenarios with per-test SQLite cleanup hooks.                        │
 * │ - Keeps subprocess caches isolated from the parent test runner.                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Selects scenario files and setup hooks without starting the application itself.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite-plus';

export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  test: {
    include: ['apps/server/test/testing/automatic-fixture-scenario.ts'],
    setupFiles: ['./apps/server/test/testing/preload.ts'],
    environment: 'node',
    fsModuleCache: false,
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000
  }
});

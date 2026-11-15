/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Configures native discovery and reporting for provider integration tests.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Discovers ordinary provider tests and writes their native JUnit report.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This configuration runs once inside the disposable provider test environment.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineConfig } from 'vite-plus';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('../../../../', import.meta.url)),
  test: {
    name: 'integrations',
    reporters: [
      'verbose',
      ['junit', { outputFile: 'apps/server/test-results/vitest/integrations.xml' }]
    ],
    include: ['apps/server/test/integrations/providers/**/*.integration.test.ts'],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 60000,
    hookTimeout: 30000
  }
});

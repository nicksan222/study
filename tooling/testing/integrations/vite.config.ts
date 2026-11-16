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

import { testPolicy } from '@study/testing';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    name: 'integrations',
    setupFiles: ['packages/testing/src/setup.ts'],
    reporters: [
      'verbose',
      ['junit', { outputFile: 'tooling/test-results/vitest/integrations.xml' }]
    ],
    include: ['tooling/testing/integrations/providers/**/*.integration.test.ts'],
    pool: 'forks',
    maxWorkers: testPolicy.workers[process.env.CI ? 'ci' : 'local'],
    testTimeout: testPolicy.tests.integration,
    hookTimeout: testPolicy.hookTimeout
  }
});

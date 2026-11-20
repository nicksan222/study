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

const cloud = process.env.STUDY_CLOUD_INTEGRATION_ENVIRONMENT === 'true';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    name: 'integrations',
    setupFiles: ['apps/server/test/testing/setup.ts'],
    reporters: [
      'verbose',
      [
        'junit',
        {
          outputFile: `tooling/test-results/vitest/${cloud ? 'cloud-integrations' : 'integrations'}.xml`
        }
      ]
    ],
    include: [
      `tooling/testing/integrations/providers/${cloud ? '{s3,azure-blob,webdav}' : 'obsidian'}/**/*.integration.test.ts`
    ],
    pool: 'forks',
    maxWorkers: testPolicy.workers[process.env.CI ? 'ci' : 'local'],
    testTimeout: testPolicy.tests.integration,
    hookTimeout: testPolicy.hookTimeout
  }
});

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Configures classified integration suites to run under Bun.                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Discovers container and real provider scenario tests.                                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The provider scenario runs only inside disposable containers.                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineConfig } from 'vite-plus';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('../../../../', import.meta.url)),
  test: {
    reporters: process.env.CI
      ? [
          'verbose',
          ['junit', { outputFile: `${process.cwd()}/test-results/vitest/integrations.xml` }]
        ]
      : ['verbose'],
    disableConsoleIntercept: true,
    include: [
      'apps/server/test/integrations/integrations.e2e.ts',
      'apps/server/test/integrations/providers/**/scenario.ts'
    ],
    pool: 'forks',
    testTimeout: 180000,
    hookTimeout: 900000
  }
});

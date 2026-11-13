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

import { defineConfig } from 'vite-plus';

import { fmt } from './tooling/oxc-config/fmt.ts';
import { lint } from './tooling/oxc-config/lint.ts';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('.', import.meta.url)),
  fmt,
  lint,
  test: {
    reporters: process.env.CI
      ? ['verbose', ['junit', { outputFile: `${process.cwd()}/test-results/vitest/junit.xml` }]]
      : ['verbose'],
    maxWorkers: 2,
    silent: 'passed-only',
    projects: [
      'apps/client',
      {
        test: {
          name: 'server',
          environment: 'node',
          include: [
            'apps/server/**/*.test.ts',
            'packages/*/test/**/*.test.ts',
            'packages/*/src/**/*.test.ts'
          ],
          exclude: [
            'packages/testing/**',
            'packages/ui/**',
            'apps/server/test/integrations/providers/**'
          ],
          setupFiles: ['./apps/server/test/testing/preload.ts'],
          pool: 'forks',
          testTimeout: 180000,
          hookTimeout: 30000
        }
      },
      {
        test: {
          name: 'tooling',
          exclude: ['**/*.browser.test.ts', '**/test-results/**'],
          environment: 'node',
          include: [
            'tooling/**/*.test.ts',
            'apps/client/test/e2e/harness/**/*.test.ts',
            'packages/testing/test/**/*.test.ts',
            'apps/desktop/src-tauri/tests/**/*.test.mjs'
          ],
          pool: 'forks',
          testTimeout: 30000
        }
      }
    ]
  }
});

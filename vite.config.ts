import { defineConfig } from 'vite-plus';

import { fmt } from './tooling/oxc-config/fmt.ts';
import { lint } from './tooling/oxc-config/lint.ts';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('.', import.meta.url)),
  fmt,
  lint,
  test: {
    reporters: ['verbose'],
    maxWorkers: 2,
    silent: 'passed-only',
    projects: [
      'apps/web',
      {
        test: {
          name: 'web-e2e',
          globalSetup: ['./apps/web/test/e2e/harness/preflight.ts'],
          testNamePattern: process.env.E2E_UPDATE
            ? new RegExp(
                process.env.E2E_UPDATE.split('/')[0]!.replaceAll('-', '[^a-z0-9]+') + '$',
                'i'
              )
            : undefined,
          environment: 'node',
          include: ['apps/web/test/e2e/*.test.ts', 'apps/web/test/e2e/harness/*.browser.test.ts'],
          isolate: false,
          sequence: { concurrent: false },
          pool: 'forks',
          testTimeout: 120000,
          hookTimeout: 30000
        }
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: [
            'apps/server/**/*.test.ts',
            'packages/*/test/**/*.test.ts',
            'packages/*/src/**/*.test.ts'
          ],
          exclude: ['packages/testing/**', 'packages/ui/**'],
          setupFiles: ['./apps/server/test/testing/preload.ts'],
          pool: 'forks',
          testTimeout: 180000,
          hookTimeout: 30000
        }
      },
      {
        test: {
          name: 'tooling',
          exclude: ['**/*.browser.test.ts'],
          environment: 'node',
          include: [
            'tooling/**/*.test.ts',
            'apps/web/test/e2e/harness/**/*.test.ts',
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

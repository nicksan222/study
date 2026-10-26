import { defineConfig, devices } from '@playwright/test';

// Every run owns its frontend/bridge; every test owns a backend and database.
const port = Number(process.env.STUDY_E2E_PORT ?? 1423);
export default defineConfig({
  testDir: './tests',
  outputDir: process.env.STUDY_E2E_ARTIFACTS ? `${process.env.STUDY_E2E_ARTIFACTS}/results` : '../../target/e2e/results',
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: process.env.STUDY_E2E_ARTIFACTS ? `${process.env.STUDY_E2E_ARTIFACTS}/report` : '../../target/e2e/report', open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } }],
  webServer: {
    env: { STUDY_FIXTURE_ONLY: '1' },
    command: `node tooling/development/frontend.mjs --port ${port} --production`,
    cwd: new URL('../..', import.meta.url).pathname,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 900_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
});

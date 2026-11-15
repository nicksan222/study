import { defineConfig } from 'playwright/test';

import { assertCapturePlatform } from './test/e2e/harness/environment.ts';
import { workflowSelection } from './test/e2e/harness/preflight.ts';

assertCapturePlatform();

export default defineConfig({
  testDir: './test/e2e',
  testMatch: [/\/e2e\/[^/]+\.test\.ts$/, /\.browser\.test\.ts$/],
  globalSetup: './test/e2e/harness/preflight.ts',
  forbidOnly: true,
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  fullyParallel: true,
  workers: 2,
  timeout: 120000,
  expect: { timeout: 5000 },
  grep: await workflowSelection(import.meta.filename, process.env.E2E_UPDATE),
  outputDir: './test-results/playwright',
  preserveOutput: process.env.E2E_REVIEW ? 'always' : 'failures-only',
  reporter: [['list'], ['html', { outputFolder: './test-results/report', open: 'never' }]],
  tag: '@stable',
  use: {
    browserName: 'chromium',
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    trace: process.env.E2E_REVIEW ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});

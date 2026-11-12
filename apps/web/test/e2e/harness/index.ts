import { StudyRpc } from '@study/contracts/rpc';
import { Appearance, Language } from '@study/contracts/settings/types';
import { createTestDatabase } from '@study/db/testing';
import { makeStudyClient } from '@study/server/client';
import { App, serve } from '@study/server/runtime';
import { studyRpcProxy } from '@study/tooling/development/rpc-proxy';
import { Effect } from 'effect';
import type { Browser, Page } from 'playwright';
import { preview } from 'vite-plus';
import { onTestFinished } from 'vite-plus/test';

import { safeName, workflowName } from './identity.ts';
import { owned } from './lifecycle.ts';
import { screenshotAssertions, updateAllowed } from './screenshots.ts';
import type { ExpectScreenshot } from './screenshots.ts';
import { testWeb } from './worker.ts';

async function withWebE2e(browser: Browser, workflow: string, run: Journey): Promise<void> {
  safeName(workflow);

  updateAllowed(workflow, 'preflight');
  const started = performance.now();
  const directory = `test-results/${workflow}/${crypto.randomUUID()}`;
  const profile = 'linux-x64-chromium';

  let acquired = started;
  let bodyFinished = started;
  let screenshots: ReturnType<typeof screenshotAssertions> | undefined;

  await owned(
    async (own) => {
      const database = await createTestDatabase();

      own(() => database.cleanup());
      const app = await App.open({ path: await database.prepare() });

      own(() => app.close());
      const server = await serve(app);

      own(() => server.close());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const settings = yield* client['settings.appSettings']({});

            yield* client['settings.saveAppSettings']({
              ...settings,
              language: Language.ENGLISH,
              appearance: Appearance.DARK,
              onboarded: true
            });
          })
        )
      );
      const web = await preview({
        configFile: Bun.fileURLToPath(new URL('../../../vite.config.ts', import.meta.url)),
        preview: {
          host: '127.0.0.1',
          port: 0,
          strictPort: false,
          proxy: studyRpcProxy(server.url)
        }
      });

      own(() => web.close());
      const address = web.httpServer.address();

      if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port');

      const context = await browser.newContext({
        baseURL: `http://127.0.0.1:${address.port}`,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        viewport: { width: 2560, height: 1440 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce'
      });

      own(() => context.close());
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

      own(async () => {
        await context.tracing.stop({ path: `${directory}/trace.zip` });
      });
      const page = await context.newPage();
      const failures: Error[] = [];

      page.on('pageerror', (error) => failures.push(error));
      await Bun.write(
        `${directory}/profile.json`,
        JSON.stringify(
          {
            profile,
            environment: '.devcontainer/devcontainer.json',
            zoom: 1,
            browser: browser.version(),
            viewport: { width: 2560, height: 1440 },
            deviceScaleFactor: 1,
            locale: 'en-US',
            timezone: 'UTC',
            appAppearance: 'dark',
            browserColorScheme: 'light',
            observedPlatform: process.platform,
            observedArchitecture: process.arch,
            observedBrowserExecutable: browser.browserType().executablePath(),
            workflow,
            revision: process.env.GITHUB_SHA ?? 'working-tree'
          },
          null,
          2
        )
      );
      screenshots = screenshotAssertions(page, workflow, directory, profile);

      acquired = performance.now();

      try {
        await run({ page, expectScreenshot: screenshots.expectScreenshot });
      } finally {
        bodyFinished = performance.now();
      }

      screenshots.verify();

      if (failures.length) throw new AggregateError(failures, 'Browser errors');
    },
    onTestFinished,
    async () => {
      if (!process.env.E2E_REVIEW) await Bun.file(`${directory}/trace.zip`).delete();
    }
  ).finally(async () => {
    // Optional measurements must not replace the journey or cleanup failure.
    await Bun.write(
      `${directory}/timing.json`,
      JSON.stringify({
        totalMs: performance.now() - started,
        startupMs: acquired - started,
        captureMs: screenshots?.captureMs ?? 0,
        teardownMs: performance.now() - bodyFinished,
        rssBytes: process.memoryUsage.rss()
      })
    ).catch(() => undefined);
  });
}

export { expect } from 'playwright/test';

type Journey = (fixture: { page: Page; expectScreenshot: ExpectScreenshot }) => Promise<void>;

/** A classified journey owns its stack; authors only describe behavior and screenshot readiness. */
export function testE2e(title: string, journey: Journey): void {
  testHarness(title, async ({ browserOwner }) => {
    await withWebE2e(await browserOwner.get(), workflowName(title), journey);
  });
}

/** Contract tests deliberately exercise failed acquisitions without registering fake app journeys. */
export const testHarness = testWeb.extend('withWebE2e', async ({ browserOwner }) => {
  return async (workflow: string, run: Journey) =>
    withWebE2e(await browserOwner.get(), workflow, run);
});

import AxeBuilder from '@axe-core/playwright';
import { createStudyMaterials } from '@study/server/testing';
import { createAiMock } from '@study/testing';
import type { Page } from 'playwright';
import { test } from 'playwright/test';

import { assertCapturePlatform } from './environment.ts';
import { safeName, workflowName } from './identity.ts';
import { captureProfile } from './profile.ts';
import { screenshotAssertions, updateAllowed } from './screenshots.ts';
import type { ExpectScreenshot } from './screenshots.ts';
import { openWebStack } from './stack.ts';
import { expect } from './visible-text.ts';

type Journey = {
  page: Page;
  expectScreenshot: ExpectScreenshot;
  loseCreationResponse: Awaited<ReturnType<typeof openWebStack>>['loseCreationResponse'];
};

type Fixtures = {
  study: ReturnType<typeof createStudyMaterials>;
  aiEnabled: boolean;
  ai: ReturnType<typeof createAiMock>;
  app: Awaited<ReturnType<typeof openWebStack>>['app'];
  webStack: Awaited<ReturnType<typeof openWebStack>>;
  journey: Journey;
  captureWorkflow: string;
};

/** Playwright owns test/worker lifetimes, browser isolation, traces and failure artifacts. */
export const testHarness = test.extend<Fixtures>({
  study: async ({ app, ai }, provide) => provide(createStudyMaterials(app, ai)),
  aiEnabled: [false, { option: true }],
  // oxlint-disable-next-line no-empty-pattern
  ai: async ({}, provide) => {
    using mock = createAiMock();

    await provide(mock);
  },
  app: async ({ webStack }, provide) => provide(webStack.app),
  captureWorkflow: ['', { option: true }],
  webStack: async ({ ai, aiEnabled }, provide) => {
    assertCapturePlatform();
    await using stack = await openWebStack({ ai: aiEnabled ? ai.runtime : undefined });

    await provide(stack);
  },
  baseURL: async ({ webStack }, provide) => provide(webStack.url),
  context: async ({ context }, provide) => {
    await context.clock.setFixedTime(new Date(captureProfile.wallTime));
    await provide(context);
  },
  journey: async ({ page, webStack, captureWorkflow, browser }, provide, info) => {
    const workflow = captureWorkflow || workflowName(info.title);

    updateAllowed(workflow, 'preflight');
    const failures: Error[] = [];
    const screenshots = screenshotAssertions(
      page,
      workflow,
      info.outputPath('captures'),
      'linux-x64-chromium',
      info,
      true
    );

    page.on('pageerror', (error) => failures.push(error));
    await info.attach('capture-profile', {
      body: JSON.stringify({ ...captureProfile, workflow, browser: browser.version() }),
      contentType: 'application/json'
    });
    await provide({
      page,
      loseCreationResponse: webStack.loseCreationResponse,
      expectScreenshot: (name, options) =>
        screenshots.expectScreenshot(name, {
          ...options,
          ready: async () => {
            await expect(page.locator('html')).toHaveCSS(
              'zoom',
              String((options.zoomPercent ?? 125) / 100),
              { timeout: 30000 }
            );
            await options.ready();
          }
        })
    });

    if (info.status === info.expectedStatus) {
      screenshots.verify();

      if (failures.length) throw new AggregateError(failures, 'Browser errors');
    }
  }
});

export { expect } from './visible-text.ts';

/** Direct native registration preserves authored source locations, file filtering and worker scheduling. */
export const testE2e = testHarness.extend<{
  expectScreenshot: ExpectScreenshot;
  expectAccessibility: (name: string) => Promise<void>;
  loseCreationResponse: Journey['loseCreationResponse'];
  requireJourney: void;
}>({
  expectScreenshot: async ({ journey }, provide) => provide(journey.expectScreenshot),
  expectAccessibility: async ({ page }, provide, info) => {
    await provide(async (name) => {
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      await info.attach(`accessibility-${safeName(name)}`, {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json'
      });
      expect.soft(result.violations).toEqual([]);
    });
  },
  loseCreationResponse: async ({ journey }, provide) => provide(journey.loseCreationResponse),
  requireJourney: [
    async ({ journey }, provide) => {
      void journey;
      await provide();
    },
    { auto: true }
  ]
});

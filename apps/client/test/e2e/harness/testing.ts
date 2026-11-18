import { createStudyMaterials } from '@study/server/testing';
import { testPolicy, createAiMock } from '@study/testing';
import { createBrowserTestApi, testBrowser } from '@study/testing/playwright';
import { expect } from '@study/testing/playwright';
import { createTestResources } from '@study/testing/resources';
import type { Page } from 'playwright';

import { assertCapturePlatform } from './environment.ts';
import { workflowName } from './identity.ts';
import { captureProfile } from './profile.ts';
import { screenshotAssertions, updateAllowed } from './screenshots.ts';
import type { ExpectScreenshot } from './screenshots.ts';
import { openWebStack } from './stack.ts';

type VisualBounds = Partial<Pick<VisualViewport, 'height' | 'width' | 'offsetLeft' | 'offsetTop'>>;

export type Journey = {
  page: Page;
  expectScreenshot: ExpectScreenshot;
  loseCreationResponse: Awaited<ReturnType<typeof openWebStack>>['loseCreationResponse'];
  setVisualViewport: (bounds: VisualBounds | null, event?: 'resize' | 'scroll') => Promise<void>;
};

type Fixtures = {
  study: Awaited<ReturnType<typeof createStudyMaterials>>;
  aiEnabled: boolean;
  chatGpt: Pick<NonNullable<Parameters<typeof openWebStack>[0]>, 'chatGptReleases'>;
  selectChatGptRelease: Awaited<ReturnType<typeof openWebStack>>['selectChatGptRelease'];
  ai: ReturnType<typeof createAiMock>;
  app: Awaited<ReturnType<typeof openWebStack>>['app'];
  rpc: Awaited<ReturnType<typeof openWebStack>>['rpc'];
  resources: ReturnType<typeof createTestResources>;
  webStack: Awaited<ReturnType<typeof openWebStack>>;
  journey: Journey;
  desktopPage: Page;
  captureWorkflow: string;
};

/** Playwright owns test/worker lifetimes, browser isolation, traces and failure artifacts. */
const testHarness = testBrowser.extend<Fixtures>({
  study: async ({ app, ai }, provide) => provide(await createStudyMaterials(app, ai)),
  aiEnabled: [false, { option: true }],
  chatGpt: [{}, { option: true }],
  selectChatGptRelease: async ({ webStack }, provide) => provide(webStack.selectChatGptRelease),
  ai: async ({ browserName: _browserName }, provide) => {
    using mock = createAiMock();

    await provide(mock);
  },
  app: async ({ webStack }, provide) => provide(webStack.app),
  rpc: async ({ webStack }, provide) => provide(webStack.rpc),
  resources: async ({ browserName: _browserName }, provide) => {
    await using resources = createTestResources();

    await provide(resources);
  },
  webStack: async ({ ai, aiEnabled, chatGpt }, provide) => {
    assertCapturePlatform();
    await using stack = await openWebStack({
      ai: aiEnabled ? ai.runtime : undefined,
      ...chatGpt
    });

    await provide(stack);
  },
  baseURL: async ({ webStack }, provide) => provide(webStack.url),
  context: async ({ context }, provide) => {
    await context.clock.setFixedTime(new Date(captureProfile.wallTime));
    await provide(context);
  },
  captureWorkflow: ['', { option: true }],
  desktopPage: async ({ browser, baseURL }, provide) => {
    await using context = await browser.newContext({ baseURL, isMobile: false, hasTouch: false });

    await context.clock.setFixedTime(new Date(captureProfile.wallTime));
    await provide(await context.newPage());
  },
  journey: async ({ page, webStack, captureWorkflow, browser }, provide, info) => {
    const workflow = captureWorkflow || workflowName(info.title);

    updateAllowed(workflow, 'preflight');
    const screenshots = screenshotAssertions(
      page,
      workflow,
      info.outputPath('captures'),
      'linux-x64-chromium',
      info,
      true
    );

    await info.attach('capture-profile', {
      body: JSON.stringify({ ...captureProfile, workflow, browser: browser.version() }),
      contentType: 'application/json'
    });
    await provide({
      page,
      loseCreationResponse: webStack.loseCreationResponse,
      setVisualViewport: (bounds, event = 'resize') =>
        page.evaluate(
          ({ bounds, event }) => {
            // Simulate the visible rectangle produced by a keyboard or pinch on a phone.
            const viewport = window.visualViewport!;

            for (const key of ['height', 'width', 'offsetLeft', 'offsetTop'] as const) {
              const value = bounds?.[key];

              if (value === undefined) Reflect.deleteProperty(viewport, key);
              else Object.defineProperty(viewport, key, { configurable: true, value });
            }

            viewport.dispatchEvent(new Event(event));
          },
          { bounds, event }
        ),
      expectScreenshot: (name, options) =>
        screenshots.expectScreenshot(name, {
          ...options,
          ready: async () => {
            await expect(page.locator('html')).toHaveCSS(
              'zoom',
              String((options.zoomPercent ?? 125) / 100),
              { timeout: testPolicy.processStartupTimeout }
            );
            await options.ready();
          }
        })
    });

    if (info.status === info.expectedStatus) {
      screenshots.verify();
    }
  }
});

const withTools = testHarness.extend<{
  expect: typeof expect;
  policy: typeof testPolicy;
  createAiMock: typeof createAiMock;
  createTestResources: typeof createTestResources;
}>({
  expect: async ({ browserName: _browserName }, provide) => provide(expect),
  policy: async ({ browserName: _browserName }, provide) => provide(testPolicy),
  createAiMock: async ({ browserName: _browserName }, provide) => provide(createAiMock),
  createTestResources: async ({ browserName: _browserName }, provide) =>
    provide(createTestResources)
});

/** Focused browser harness cases use the same environment and classification APIs. */
export const test = { browser: createBrowserTestApi(withTools) };

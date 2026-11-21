import { catalogs } from '@study/localization';
import { createStudyMaterials, createVoiceMock } from '@study/server/testing';
import { testPolicy, createAiMock } from '@study/testing';
import { createBrowserTestApi, testBrowser } from '@study/testing/playwright';
import { expect } from '@study/testing/playwright';
import { createTestResources } from '@study/testing/resources';
import type { Locator, Page } from 'playwright';

import { assertCapturePlatform } from './environment.ts';
import { transferFile } from './file-transfer.ts';
import { workflowName } from './identity.ts';
import { controlMicrophone } from './microphone.ts';
import { captureProfile } from './profile.ts';
import { screenshotAssertions, updateAllowed } from './screenshots.ts';
import type { ExpectScreenshot } from './screenshots.ts';
import { openSourcePeer } from './source-fetch.ts';
import { openWebStack } from './stack.ts';

type VisualBounds = Partial<Pick<VisualViewport, 'height' | 'width' | 'offsetLeft' | 'offsetTop'>>;

export type Journey = {
  page: Page;
  transferFile: typeof transferFile;
  expectScreenshot: ExpectScreenshot;
  loseCreationResponse: Awaited<ReturnType<typeof openWebStack>>['loseCreationResponse'];
  setVisualViewport: (bounds: VisualBounds | null, event?: 'resize' | 'scroll') => Promise<void>;
};

type Fixtures = {
  study: Awaited<ReturnType<typeof createStudyMaterials>>;
  aiEnabled: boolean;
  modelUpdateNotices: boolean;
  microphoneEnabled: boolean;
  microphone: Awaited<ReturnType<typeof createMicrophone>>;
  chatGpt: Pick<NonNullable<Parameters<typeof openWebStack>[0]>, 'chatGptReleases'>;
  selectChatGptRelease: Awaited<ReturnType<typeof openWebStack>>['selectChatGptRelease'];
  ai: ReturnType<typeof createAiMock>;
  app: Awaited<ReturnType<typeof openWebStack>>['app'];
  rpc: Awaited<ReturnType<typeof openWebStack>>['rpc'];
  resources: ReturnType<typeof createTestResources>;
  webStack: Awaited<ReturnType<typeof openWebStack>> & {
    bindMicrophone: (page: Page) => ReturnType<typeof createMicrophone>;
  };
  journey: Journey;
  desktopPage: Page;
  captureWorkflow: string;
  sourcePeer: ReturnType<typeof openSourcePeer>;
  useDefaultNoteAppearance: boolean;
};

/** Playwright owns test/worker lifetimes, browser isolation, traces and failure artifacts. */
const testHarness = testBrowser.extend<Fixtures>({
  study: async ({ app, ai }, provide) => provide(await createStudyMaterials(app, ai)),
  aiEnabled: [false, { option: true }],
  modelUpdateNotices: [false, { option: true }],
  microphoneEnabled: [false, { option: true }],
  microphone: async ({ page, webStack }, provide) => {
    await provide(await webStack.bindMicrophone(page));
  },
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
  captureWorkflow: ['', { option: true }],
  sourcePeer: async ({ browserName: _browserName }, provide) => {
    await using peer = openSourcePeer();

    await provide(peer);
  },
  useDefaultNoteAppearance: [false, { option: true }],
  webStack: async (
    { ai, aiEnabled, chatGpt, microphoneEnabled, modelUpdateNotices, useDefaultNoteAppearance },
    provide
  ) => {
    assertCapturePlatform();
    using voice = microphoneEnabled ? createVoiceMock() : undefined;

    await using stack = await openWebStack({
      ai: aiEnabled ? ai.runtime : undefined,
      modelUpdateNotices,
      voice: voice?.runtime,
      useDefaultNoteAppearance,
      ...chatGpt
    });

    await provide({
      ...stack,
      bindMicrophone: (page) => {
        if (!voice) throw new Error('Enable the microphone fixture with test.browser.use');

        return createMicrophone(page, voice);
      }
    });
  },
  baseURL: async ({ webStack }, provide) => provide(webStack.url),
  context: async ({ context }, provide) => {
    await context.clock.setFixedTime(new Date(captureProfile.wallTime));
    await provide(context);
  },
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
      transferFile,
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

type VoiceMock = ReturnType<typeof createVoiceMock>;

type Transcript = string | { error: 'transient' } | { text: string; completeAfterAbort: true };

function expectSegment(voice: VoiceMock, outcome: Transcript) {
  const response = voice.next(typeof outcome === 'string' ? { text: outcome } : outcome, {
    hold: true,
    completeAfterAbort: typeof outcome === 'object' && 'completeAfterAbort' in outcome
  });

  return {
    requested: response.called,
    aborted: response.aborted,
    settled: response.settled,
    withdraw: response.withdraw,
    async deliver() {
      const input = await response.called;

      response.release();

      return input;
    }
  };
}

/** Exposes browser recording and its planned recognizer replies as one fixture. */
async function createMicrophone(page: Page, voice: VoiceMock) {
  const capture = await controlMicrophone(page);

  return {
    model: {
      get downloads() {
        return voice.downloads;
      },
      holdDownload() {
        const download = voice.holdDownload();

        return { requested: download.called, aborted: download.aborted };
      }
    },
    async start<const Plan extends Record<string, Transcript> = Record<never, never>>(
      scope: Page | Locator,
      { segments, holdPermission = false }: { segments?: Plan; holdPermission?: boolean } = {}
    ) {
      const permission = capture.arm();
      const planned: ReturnType<typeof expectSegment>[] = [];
      const planReply = (outcome: Transcript) => {
        const reply = expectSegment(voice, outcome);

        planned.push(reply);

        return reply;
      };
      const withdraw = () => planned.forEach((reply) => reply.withdraw());
      const replies = Object.fromEntries(
        Object.entries(segments ?? {}).map(([name, outcome]) => [name, planReply(outcome)])
      ) as { [Name in keyof Plan]: ReturnType<typeof expectSegment> };
      const { VoiceStart, VoiceStarting, VoiceStop, VoiceCancel } = catalogs.english;
      const finish = scope.getByRole('button', { name: VoiceStop, exact: true });
      const allow = async () => {
        permission.release();
        // The app exposes Finish only after the worklet delivers its first audio frame.
        await finish.waitFor();
      };

      try {
        await scope.getByRole('button', { name: VoiceStart, exact: true }).click();
        await Promise.all([
          permission.requested,
          scope.getByRole('status', { name: VoiceStarting, exact: true }).waitFor()
        ]);

        if (!holdPermission) await allow();
      } catch (error) {
        permission.dispose();
        withdraw();

        throw error;
      }

      return {
        allow,
        segments: replies,
        expectSegment: planReply,
        setElapsed: capture.setElapsed,
        stop: () => finish.click(),
        async cancel() {
          try {
            await scope.getByRole('button', { name: VoiceCancel, exact: true }).click();
          } finally {
            permission.dispose();
            withdraw();
          }
        }
      };
    }
  };
}

import { createBrowserTestApi } from '@study/testing/playwright';

import type { ExpectScreenshot } from './screenshots.ts';
import { test as harness } from './testing.ts';
import type { Journey } from './testing.ts';

/** Direct native registration preserves authored source locations, file filtering and worker scheduling. */
const testE2e = harness.browser.stable.extend<{
  expectScreenshot: ExpectScreenshot;
  loseCreationResponse: Journey['loseCreationResponse'];
  setVisualViewport: Journey['setVisualViewport'];
}>({
  expectScreenshot: async ({ journey }, provide) => provide(journey.expectScreenshot),
  loseCreationResponse: async ({ journey }, provide) => provide(journey.loseCreationResponse),
  setVisualViewport: async ({ journey }, provide) => provide(journey.setVisualViewport)
});

/** Application journeys acquire the full real stack through their classified registration. */
export const test = { browser: createBrowserTestApi(testE2e) };

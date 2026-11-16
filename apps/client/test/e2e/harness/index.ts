import type { ExpectScreenshot } from './screenshots.ts';
import { test as harness } from './testing.ts';
import type { Journey } from './testing.ts';

/** Direct native registration preserves authored source locations, file filtering and worker scheduling. */
const testE2e = harness.stable.extend<{
  expectScreenshot: ExpectScreenshot;
  loseCreationResponse: Journey['loseCreationResponse'];
}>({
  expectScreenshot: async ({ journey }, provide) => provide(journey.expectScreenshot),
  loseCreationResponse: async ({ journey }, provide) => provide(journey.loseCreationResponse)
});

/** Application journeys acquire the full real stack through their classified registration. */
export const test = { ...harness, stable: testE2e };

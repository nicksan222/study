import { createBrowserTestApi } from '@study/testing/playwright';

import { placeCaretAtEnd, selectEditorText } from './editor-selection.ts';
import { transferFile } from './file-transfer.ts';
import type { ExpectScreenshot } from './screenshots.ts';
import { test as harness } from './testing.ts';
import type { Journey } from './testing.ts';

/** Direct native registration preserves authored source locations, file filtering and worker scheduling. */
const testE2e = harness.browser.stable.extend<{
  expectScreenshot: ExpectScreenshot;
  loseCreationResponse: Journey['loseCreationResponse'];
  setVisualViewport: Journey['setVisualViewport'];
  transferFile: typeof transferFile;
  placeCaretAtEnd: typeof placeCaretAtEnd;
  selectEditorText: typeof selectEditorText;
}>({
  expectScreenshot: async ({ journey }, provide) => provide(journey.expectScreenshot),
  loseCreationResponse: async ({ journey }, provide) => provide(journey.loseCreationResponse),
  placeCaretAtEnd: async ({ browserName: _browserName }, provide) => provide(placeCaretAtEnd),
  selectEditorText: async ({ browserName: _browserName }, provide) => provide(selectEditorText),
  transferFile: async ({ browserName: _browserName }, provide) => provide(transferFile),
  setVisualViewport: async ({ journey }, provide) => provide(journey.setVisualViewport)
});

/** Application journeys acquire the full real stack through their classified registration. */
export const test = { browser: createBrowserTestApi(testE2e) };

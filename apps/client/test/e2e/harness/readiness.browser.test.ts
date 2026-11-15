import { expect } from 'playwright/test';

import { testHarness } from './index.ts';
import { screenshotAssertions, compareScreenshot } from './screenshots.ts';

// These exercise the harness contract itself, rather than pretending synthetic HTML is an app journey.
testHarness(
  'screenshot readiness has a deadline and rejects a stable loading state',
  async ({ page }, info) => {
    await page.setContent('<p>Loading</p>');
    const directory = info.outputPath('contract');
    const screenshots = screenshotAssertions(page, 'readiness-contract', directory, 'contract');

    await expect(
      screenshots.expectScreenshot('loading', {
        target: 'viewport',
        ready: () => new Promise(() => {}),
        timeoutMs: 100
      })
    ).rejects.toThrow('readiness or rendering timed out');
    expect(await Bun.file(`${directory}/loading-unready.png`).exists()).toBe(true);
    await page.setContent('<img src="data:image/png;base64,broken" />');
    await expect(
      screenshots.expectScreenshot('broken-image', {
        target: 'viewport',
        ready: async () => {},
        timeoutMs: 1000
      })
    ).rejects.toThrow('The source image cannot be decoded');
  }
);

testHarness(
  'a real layout perturbation produces a pixel diff and explicit update restores comparison',
  async ({ page }, info) => {
    await page.setContent('<div style="width:100px;height:100px;background:black"></div>');
    const directory = info.outputPath('contract');
    const reference = `${directory}/layout.png`;
    const initial = await page.screenshot();

    await compareScreenshot(reference, initial, `${directory}/initial`, true);
    await page.locator('div').evaluate((element) => {
      element.style.width = '150px';
    });
    const changed = await page.screenshot();

    await expect(
      compareScreenshot(reference, changed, `${directory}/changed`, false)
    ).rejects.toThrow('changed pixels');
    expect(await Bun.file(`${directory}/changed-diff.png`).exists()).toBe(true);
    await compareScreenshot(reference, changed, `${directory}/updated`, true);
    await compareScreenshot(reference, changed, `${directory}/restored`, false);
  }
);

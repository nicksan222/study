import { expect } from 'playwright/test';

import { testHarness } from './index.ts';
import { screenshotAssertions, baselinePath } from './screenshots.ts';

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

testHarness('missing references fail without creating a baseline', async ({ page }, info) => {
  await page.setContent('<div style="width:100px;height:100px;background:black"></div>');
  const workflow = `missing-${crypto.randomUUID()}`;
  const reference = baselinePath('contract', workflow, 'layout');
  const screenshots = screenshotAssertions(page, workflow, info.outputPath('contract'), 'contract');

  await expect(
    screenshots.expectScreenshot('layout', {
      target: 'viewport',
      ready: async () => {}
    })
  ).rejects.toThrow('snapshot');
  expect(await Bun.file(reference).exists()).toBe(false);
});

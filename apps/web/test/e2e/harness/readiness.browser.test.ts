import { catalogs } from '@study/localization';
import { expect, vi } from 'vite-plus/test';

import { expect as expectWeb, testHarness } from './index.ts';
import { screenshotAssertions, compareScreenshot } from './screenshots.ts';

// These exercise the harness contract itself, rather than pretending synthetic HTML is an app journey.
testHarness(
  'screenshot readiness has a deadline and rejects a stable loading state',
  async ({ browserOwner }) => {
    const browser = await browserOwner.get();
    const context = await browser.newContext();

    try {
      const page = await context.newPage();

      await page.setContent('<p>Loading</p>');
      const directory = `test-results/contracts/${crypto.randomUUID()}`;
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
    } finally {
      await context.close();
    }
  }
);

testHarness(
  'a real layout perturbation produces a pixel diff and explicit update restores comparison',
  async ({ browserOwner }) => {
    const browser = await browserOwner.get();
    const context = await browser.newContext();

    try {
      const page = await context.newPage();

      await page.setContent('<div style="width:100px;height:100px;background:black"></div>');
      const directory = `test-results/contracts/${crypto.randomUUID()}`;
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
    } finally {
      await context.close();
    }
  }
);

testHarness(
  'owned teardown interrupts in-flight readiness after a screenshot deadline',
  async ({ browserOwner }) => {
    const { owned } = await import('./lifecycle.ts');
    const context = await (await browserOwner.get()).newContext();
    const page = await context.newPage();
    const pendingReadiness = page.evaluate(() => new Promise<void>(() => {}));
    // Attach rejection handling before teardown interrupts the browser promise.
    const interrupted = pendingReadiness.catch((error: unknown) => error);
    const screenshots = screenshotAssertions(
      page,
      'owned-deadline',
      `test-results/contracts/${crypto.randomUUID()}`,
      'contract'
    );

    await expect(
      owned(async (own) => {
        own(() => context.close());
        await screenshots.expectScreenshot('pending', {
          target: 'viewport',
          ready: () => pendingReadiness,
          timeoutMs: 100
        });
      })
    ).rejects.toThrow('Web E2E failed');
    expect(await interrupted).toBeInstanceOf(Error);
    expect(page.isClosed()).toBe(true);
  }
);

testHarness(
  'real provisional traces survive failed cleanup and review but are removed on success',
  async ({ withWebE2e }) => {
    for (const mode of ['cleanup-failure', 'success', 'review']) {
      const original = new Error('cleanup after successful body');
      let stopped: ReturnType<typeof vi.spyOn> | undefined;

      vi.stubEnv('E2E_REVIEW', mode === 'review' ? '1' : undefined);

      try {
        const result = withWebE2e(
          'closing-settings-preserves-the-underlying-route',
          async ({ page, expectScreenshot }) => {
            expect(
              await page.evaluate(() => ({
                width: innerWidth,
                height: innerHeight,
                dpr: devicePixelRatio,
                zoom: visualViewport?.scale
              }))
            ).toEqual({ width: 2560, height: 1440, dpr: 1, zoom: 1 });

            const context = page.context();

            stopped = vi.spyOn(context.tracing, 'stop');

            if (mode === 'cleanup-failure') {
              const close = context.close.bind(context);

              vi.spyOn(context, 'close').mockImplementation(async (options) => {
                await close(options);

                throw original;
              });
            }

            if (mode === 'cleanup-failure') {
              await expect(
                expectScreenshot('before-appearance', {
                  target: 'viewport',
                  ready: async () => {},
                  timeoutMs: 100
                })
              ).rejects.toThrow('readiness or rendering timed out');
            }

            await page.goto('/notes');
            await expectWeb(page.locator('html')).toHaveCSS('zoom', '1.25');
            await page
              .getByRole('button', { name: catalogs.english.Settings, exact: true })
              .click();
            const dialog = page.getByRole('dialog', { name: catalogs.english.Settings });

            await expectScreenshot('settings', {
              target: dialog,
              ready: () => expectWeb(dialog).toBeVisible()
            });
          }
        );

        if (mode === 'cleanup-failure')
          await expect(result).rejects.toMatchObject({ errors: [original] });
        else await result;

        const path = stopped!.mock.calls[0]![0]?.path;

        expect(path).toBeDefined();
        expect(await Bun.file(path!).exists()).toBe(mode !== 'success');
      } finally {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
      }
    }
  }
);

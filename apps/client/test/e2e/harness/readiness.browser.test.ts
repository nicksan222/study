import { test } from '@study/testing';

import { screenshotAssertions, baselinePath } from './screenshots.ts';

// These exercise the harness contract itself, rather than pretending synthetic HTML is an app journey.
test.stable(
  'screenshot readiness has a deadline and rejects a stable loading state',
  async ({ page, expect }, info) => {
    await page.setContent('<p>Loading</p>');
    const directory = info.outputPath('contract');
    const screenshots = screenshotAssertions(
      page,
      'readiness-contract',
      directory,
      'contract',
      info
    );

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

test.stable(
  'missing references fail without creating a baseline',
  async ({ page, expect }, info) => {
    await page.setContent('<div style="width:100px;height:100px;background:black"></div>');
    const workflow = `missing-${crypto.randomUUID()}`;
    const reference = baselinePath('contract', workflow, 'layout');
    const screenshots = screenshotAssertions(
      page,
      workflow,
      info.outputPath('contract'),
      'contract',
      info
    );

    await expect(
      screenshots.expectScreenshot('layout', {
        target: 'viewport',
        ready: async () => {}
      })
    ).rejects.toThrow('snapshot');
    expect(await Bun.file(reference).exists()).toBe(false);
  }
);

test.stable(
  'screenshot comparison allows isolated drift but rejects larger and resized changes',
  async ({ page, resources, expect }, info) => {
    const workflow = `drift-${crypto.randomUUID()}`;
    const screenshots = screenshotAssertions(
      page,
      workflow,
      info.outputPath('contract'),
      'contract',
      info
    );

    for (const [name, size, pixels, resized, accepted] of [
      ['small-drift', 100, 1, false, true],
      ['small-regression', 100, 2, false, false],
      ['large-drift', 1000, 10, false, true],
      ['large-regression', 1000, 11, false, false],
      ['resized', 100, 0, true, false]
    ] as const) {
      await page.setContent('<canvas></canvas>');
      const canvas = page.locator('canvas');

      await page.evaluate((size) => {
        const element = document.querySelector('canvas')!;

        element.width = size;
        element.height = size;
        const context = element.getContext('2d')!;

        context.fillStyle = 'black';
        context.fillRect(0, 0, size, size);
      }, size);
      const reference = baselinePath('contract', workflow, name);

      resources.defer(() => Bun.file(reference).delete());
      await Bun.write(reference, await canvas.screenshot());
      await page.evaluate(
        ({ pixels, resized }) => {
          const element = document.querySelector('canvas')!;

          if (resized) element.width++;

          const context = element.getContext('2d')!;

          context.fillStyle = 'black';
          context.fillRect(0, 0, element.width, element.height);
          context.fillStyle = 'white';

          for (let pixel = 0; pixel < pixels; pixel++) context.fillRect(10 + pixel * 3, 10, 1, 1);
        },
        { pixels, resized }
      );
      const comparison = screenshots.expectScreenshot(name, {
        target: canvas,
        ready: async () => {},
        timeoutMs: 2000
      });

      if (accepted) await comparison;
      else
        await expect(comparison).rejects.toThrow(
          resized ? /Expected an image/ : /pixels .*different/
        );
    }
  }
);

test.stable(
  'capture anchors a zoomed scroller at its end from every starting position',
  async ({ page, resources, expect }, info) => {
    const workflow = `scroll-end-${crypto.randomUUID()}`;
    const screenshots = screenshotAssertions(
      page,
      workflow,
      info.outputPath('contract'),
      'contract',
      info
    );

    await page.setContent(
      '<html style="zoom:200%"><div id="scroller" style="width:200px;height:100px;overflow:auto"><div style="height:600px;background:linear-gradient(red,blue)">Content</div></div></html>'
    );
    const scroller = page.locator('#scroller');

    for (const [name, initial] of [
      ['top', 0],
      ['middle', 250],
      ['bottom', 500]
    ] as const) {
      await scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const reference = baselinePath('contract', workflow, name);

      resources.defer(() => Bun.file(reference).delete());
      await Bun.write(reference, await scroller.screenshot());
      await scroller.evaluate((el, value) => {
        el.scrollTop = value;
      }, initial);
      await screenshots.expectScreenshot(name, {
        target: scroller,
        scrollToEnd: scroller,
        ready: () => expect(scroller).toBeVisible(),
        timeoutMs: 2000
      });
      await expect(scroller).toHaveJSProperty('scrollTop', 500);
    }
  }
);

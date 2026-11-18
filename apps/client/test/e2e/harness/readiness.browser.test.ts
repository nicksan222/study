import { test } from '@study/testing';

import { screenshotAssertions, baselinePath } from './screenshots.ts';

// These exercise the harness contract itself, rather than pretending synthetic HTML is an app journey.
test.browser.stable(
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

test.browser.stable(
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

test.browser.stable(
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

test.browser.stable(
  'scoped regeneration preserves equivalent PNGs and writes real visual changes',
  async ({ page, resources, expect }, info) => {
    const workflow = `regeneration-${crypto.randomUUID()}`;
    const name = 'layout';
    const reference = Bun.file(baselinePath('contract', workflow, name));
    const previousScope = process.env.E2E_UPDATE;
    const previousCi = process.env.CI;
    const screenshots = () =>
      screenshotAssertions(page, workflow, info.outputPath('contract'), 'contract', info);

    resources.defer(() => reference.delete());
    await page.setContent(`
      <div id="frame" style="width:120px;height:100px;background:white;position:relative;overflow:hidden">
        <div id="content" style="position:absolute;inset:0">
          <div style="width:30px;height:30px;background:black;position:absolute;left:20px;top:20px"></div>
          <div style="width:20px;height:20px;background:red;position:absolute;left:65px;top:60px"></div>
        </div>
        <div id="pixel" style="width:1px;height:1px;position:absolute;top:5px;left:5px"></div>
      </div>
    `);
    const frame = page.locator('#frame');
    const content = page.locator('#content');
    const pixel = page.locator('#pixel');
    const capture = () =>
      screenshots().expectScreenshot(name, {
        target: frame,
        ready: () => expect(frame).toBeVisible()
      });

    try {
      delete process.env.CI;
      process.env.E2E_UPDATE = `${workflow}/${name}`;
      await capture();
      const original = await reference.bytes();

      await pixel.evaluate((element) => {
        element.style.background = 'black';
      });
      await capture();
      expect(await reference.bytes()).toEqual(original);
      await pixel.evaluate((element) => {
        element.style.background = '';
      });

      for (const offset of [3, -2]) {
        await content.evaluate((element, x) => {
          element.style.transform = `translateX(${x}px)`;
        }, offset);
        process.env.E2E_UPDATE = `${workflow}/${name}`;
        await capture();
        expect(await reference.bytes()).toEqual(original);

        delete process.env.E2E_UPDATE;
        await capture();
      }

      // A new visible edge is still a change when the rest of the frame aligns.
      await pixel.evaluate((element) => {
        element.style.cssText =
          'width:2px;height:30px;position:absolute;right:0;top:30px;background:blue';
      });
      await expect(capture()).rejects.toThrow(/pixels .*different/);
      process.env.E2E_UPDATE = `${workflow}/${name}`;
      await capture();
      expect(await reference.bytes()).toEqual(new Uint8Array(await frame.screenshot()));
      expect(await reference.bytes()).not.toEqual(original);
    } finally {
      if (previousScope === undefined) delete process.env.E2E_UPDATE;
      else process.env.E2E_UPDATE = previousScope;

      if (previousCi === undefined) delete process.env.CI;
      else process.env.CI = previousCi;
    }
  }
);

test.browser.stable(
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

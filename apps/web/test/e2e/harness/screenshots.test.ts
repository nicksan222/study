import { testStable } from '@study/testing/vitest';
import type { Page } from 'playwright';
import { PNG } from 'pngjs';
import { expect } from 'vite-plus/test';

import { safeName } from './identity.ts';
import { compareImages, updateAllowed, requireScreenshots } from './screenshots.ts';

function image(width = 2, height = 2, white = false) {
  const png = new PNG({ width, height });

  png.data.fill(white ? 255 : 0);

  for (let pixel = 3; pixel < png.data.length; pixel += 4) png.data[pixel] = 255;

  return PNG.sync.write(png);
}

testStable('pixel comparisons reject changed pixels and dimensions', () => {
  expect(compareImages(image(), image()).equal).toBe(true);
  const changed = compareImages(image(), image(2, 2, true));

  expect(changed.equal).toBe(false);
  expect(changed.diff).toBeDefined();
  expect(compareImages(image(), image(3, 2)).equal).toBe(false);
});

testStable('screenshot paths and scoped baseline updates fail closed', () => {
  for (const name of ['../escape', '/absolute', '', 'a/b', 'x'.repeat(81)])
    expect(() => safeName(name)).toThrow();

  expect(safeName('editing-middle')).toBe('editing-middle');
  expect(
    updateAllowed('notes-edit-and-reopen', 'editing', {
      E2E_UPDATE: 'notes-edit-and-reopen/editing'
    })
  ).toBe(true);
  expect(
    updateAllowed('home-to-projects', 'editing', { E2E_UPDATE: 'notes-edit-and-reopen/editing' })
  ).toBe(false);
  expect(() =>
    updateAllowed('notes-edit-and-reopen', 'editing', {
      E2E_UPDATE: 'notes-edit-and-reopen',
      CI: 'true'
    })
  ).toThrow();
  expect(() => requireScreenshots(0)).toThrow('screenshot');
  expect(() => requireScreenshots(1)).not.toThrow();
});

testStable(
  'missing and changed references preserve actionable evidence without accepting pixels',
  async () => {
    const { compareScreenshot } = await import('./screenshots.ts');
    const directory = `test-results/contracts/${crypto.randomUUID()}`;
    const reference = `${directory}/reference.png`;
    const actual = image();

    await expect(
      compareScreenshot(reference, actual, `${directory}/missing`, false)
    ).rejects.toThrow('Missing baseline');
    expect(await Bun.file(reference).exists()).toBe(false);
    expect(await Bun.file(`${directory}/missing-actual.png`).exists()).toBe(true);
    await compareScreenshot(reference, actual, `${directory}/update`, true);
    await compareScreenshot(reference, actual, `${directory}/equal`, false);
    await expect(
      compareScreenshot(reference, image(2, 2, true), `${directory}/changed`, false)
    ).rejects.toThrow('changed pixels');
    expect(await Bun.file(`${directory}/changed-expected.png`).exists()).toBe(true);
    expect(await Bun.file(`${directory}/changed-diff.png`).exists()).toBe(true);
    expect(new Uint8Array(await Bun.file(reference).arrayBuffer())).toEqual(new Uint8Array(actual));
  }
);

testStable('perceptual allowance accepts tiny color drift but rejects a real changed pixel', () => {
  const initial = PNG.sync.read(image());
  const subtle = PNG.sync.read(image());

  subtle.data[0] = 2;
  subtle.data[1] = 2;
  subtle.data[2] = 2;
  expect(compareImages(PNG.sync.write(initial), PNG.sync.write(subtle)).equal).toBe(true);
  subtle.data[0] = 255;
  subtle.data[1] = 255;
  subtle.data[2] = 255;
  expect(compareImages(PNG.sync.write(initial), PNG.sync.write(subtle)).equal).toBe(false);
});

testStable('expired readiness stages cannot resume screenshot browser work', async () => {
  const { screenshotAssertions } = await import('./screenshots.ts');

  for (const stage of ['ready', 'fonts', 'images']) {
    const delayed = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const calls: string[] = [];
    const pause = async (name: string) => {
      calls.push(name);

      if (name === stage) {
        reached.resolve();
        await delayed.promise;
      }
    };
    const page = {
      evaluate: () => pause('fonts'),
      locator: () => ({ evaluate: () => pause('images') }),
      screenshot: async (options: { path?: string }) => {
        calls.push(options.path ? 'diagnostic' : 'capture');

        return Buffer.from([]);
      }
    };
    const screenshots = screenshotAssertions(
      page as unknown as Page,
      'late',
      'test-results/late',
      'contract'
    );
    const pending = screenshots.expectScreenshot(stage, {
      target: 'viewport',
      ready: () => pause('ready'),
      timeoutMs: 30
    });

    await reached.promise;
    await expect(pending).rejects.toThrow('timed out');
    expect(screenshots.captureMs).toBeGreaterThan(0);
    const atDeadline = [...calls];

    delayed.resolve();

    // Drain the finite harness continuation after the delayed promise resolves.
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();

    expect(calls).toEqual(atDeadline);
  }
});

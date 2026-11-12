import pixelmatch from 'pixelmatch';
import type { Locator, Page } from 'playwright';
import { PNG } from 'pngjs';

import { safeName } from './identity.ts';

export function updateAllowed(workflow: string, name: string, env = process.env): boolean {
  if (env.E2E_UPDATE && env.CI) throw new Error('Baseline updates are forbidden in CI');

  return env.E2E_UPDATE === workflow || env.E2E_UPDATE === `${workflow}/${name}`;
}

export function requireScreenshots(count: number): void {
  if (!count) throw new Error('Every E2E must complete at least one screenshot');
}

export function compareImages(expected: Uint8Array, actual: Uint8Array) {
  const a = PNG.sync.read(Buffer.from(expected));
  const b = PNG.sync.read(Buffer.from(actual));
  const diff = new PNG({ width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) });

  if (a.width !== b.width || a.height !== b.height) {
    diff.data.fill(255);

    return { equal: false, diff: PNG.sync.write(diff), reason: 'Image dimensions changed' };
  }

  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.2,
    includeAA: false
  });

  return { equal: changed === 0, diff: PNG.sync.write(diff), reason: `${changed} changed pixels` };
}

export async function compareScreenshot(
  expectedPath: string,
  actual: Uint8Array,
  artifact: string,
  update: boolean
) {
  await Bun.write(`${artifact}-actual.png`, actual);

  if (update) {
    await Bun.write(expectedPath, actual);

    return;
  }

  if (!(await Bun.file(expectedPath).exists()))
    throw new Error(`Missing baseline: ${expectedPath}`);

  const expected = new Uint8Array(await Bun.file(expectedPath).arrayBuffer());

  const result = compareImages(expected, actual);

  if (!result.equal) {
    await Bun.write(`${artifact}-expected.png`, expected);
    await Bun.write(`${artifact}-diff.png`, result.diff);

    throw new Error(`${result.reason}: ${artifact}`);
  }
}

export type ExpectScreenshot = (
  name: string,
  options: {
    target: Locator | 'viewport';
    ready: () => Promise<void>;
    timeoutMs?: number;
  }
) => Promise<void>;

/** One deadline covers application assertions, fonts, images and consecutive identical captures. */
export function screenshotAssertions(
  page: Page,
  workflow: string,
  directory: string,
  profile: string
) {
  let count = 0;
  let captureMs = 0;
  const names = new Set<string>();
  const expectScreenshot: ExpectScreenshot = async (name, { target, ready, timeoutMs = 15000 }) => {
    safeName(name);

    if (names.has(name)) throw new Error(`Duplicate screenshot: ${name}`);

    names.add(name);
    const started = performance.now();
    const deadline = Date.now() + Math.min(timeoutMs, 15000);
    let expired = false;
    const timeout = new Error(`Screenshot ${workflow}/${name} readiness or rendering timed out`);
    const fence = () => {
      if (expired || Date.now() >= deadline) throw timeout;
    };
    const remaining = () => Math.max(1, deadline - Date.now());
    const capture = () => {
      fence();

      return (target === 'viewport' ? page : target).screenshot({
        animations: 'disabled',
        caret: 'hide',
        timeout: remaining()
      });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const actual = await Promise.race([
        (async () => {
          await ready();
          fence();
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          fence();
          const root = target === 'viewport' ? page.locator('body') : target;

          await root.evaluate(async (element) => {
            const images = [...element.querySelectorAll('img')];

            if (element instanceof HTMLImageElement) images.push(element);

            await Promise.all(images.map((image) => image.decode()));
          });
          fence();
          let previous = await capture();

          fence();

          while (Date.now() < deadline) {
            const next = await capture();

            fence();

            if (previous.equals(next)) return next;

            previous = next;
          }

          throw new Error('Rendering did not stabilize');
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(timeout);
          }, remaining());
        })
      ]);

      await compareScreenshot(
        Bun.fileURLToPath(
          new URL(`../baselines/${profile}/${workflow}/${name}.png`, import.meta.url)
        ),
        actual,
        `${directory}/${name}`,
        updateAllowed(workflow, name)
      );

      if (updateAllowed(workflow, name) && process.env.E2E_UPDATE_RUN) {
        const updateRun = safeName(process.env.E2E_UPDATE_RUN);

        await Bun.write(
          `test-results/updates/${updateRun}/${workflow}-${name}.json`,
          JSON.stringify({ workflow, screenshot: name })
        );
      }

      count++;
    } catch (error) {
      await page
        .screenshot({
          path: `${directory}/${name}-unready.png`,
          animations: 'disabled',
          timeout: 1000
        })
        .catch(() => undefined);

      throw error;
    } finally {
      expired = true;
      clearTimeout(timer);
      captureMs += performance.now() - started;
    }
  };

  return {
    expectScreenshot,
    verify: () => requireScreenshots(count),
    get captureMs() {
      return captureMs;
    }
  };
}

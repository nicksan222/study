import { expect } from '@study/testing/playwright';
import type { Locator, Page } from 'playwright';
import type { TestInfo } from 'playwright/test';

import { safeName } from './identity.ts';
import { assertSnapshotComparison } from './preflight.ts';
import {
  matchesBaseline,
  matchesHorizontalShift,
  screenshotTolerance
} from './screenshot-comparison.ts';

export function updateAllowed(workflow: string, name: string, env = process.env): boolean {
  if (env.E2E_UPDATE && env.CI) throw new Error('Baseline updates are forbidden in CI');

  return env.E2E_UPDATE === workflow || env.E2E_UPDATE === `${workflow}/${name}`;
}

export function requireScreenshots(count: number): void {
  if (!count) throw new Error('Every E2E must complete at least one screenshot');
}

export type ExpectScreenshot = (
  name: string,
  options: {
    target: Locator | 'viewport';
    center?: Locator;
    centerWithin?: Locator;
    /** Anchor the owner scroller at its end when zoom makes centering clamp ambiguously. */
    scrollToEnd?: Locator;
    ready: () => Promise<void>;
    timeoutMs?: number;
    /** Expected application zoom for journeys that exercise the appearance scale. */
    zoomPercent?: number;
    /** Keep intentional focus snapshots; otherwise normalize only passive notebook entry focus. */
    focus?: 'preserve';
  }
) => Promise<void>;

/** Study owns readiness and scoped updates; Playwright owns comparison and diagnostic images. */
export function screenshotAssertions(
  page: Page,
  workflow: string,
  directory: string,
  profile: string,
  info: {
    config: Pick<TestInfo['config'], 'updateSnapshots'>;
    project: Pick<TestInfo['project'], 'ignoreSnapshots'>;
  },
  soft = false
) {
  let count = 0;
  let captureMs = 0;
  const names = new Set<string>();
  const expectScreenshot: ExpectScreenshot = async (
    name,
    { target, ready, timeoutMs = 30000, focus, center, centerWithin, scrollToEnd }
  ) => {
    safeName(name);

    if (names.has(name)) throw new Error(`Duplicate screenshot: ${name}`);

    names.add(name);
    const updating = updateAllowed(workflow, name);
    const started = performance.now();
    const deadline = Date.now() + Math.min(timeoutMs, 30000);
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
        scale: 'css',
        timeout: remaining()
      });
    };
    const captureStable = async (first: Buffer) => {
      let previous = first;

      await expect
        .poll(
          async () => {
            const actual = await capture();
            const stable = previous.equals(actual);

            previous = actual;

            return stable;
          },
          { timeout: remaining() }
        )
        .toBe(true);
      fence();

      return previous;
    };
    const updateReference = async (path: string, expected: Buffer | undefined) => {
      // Native update mode is run-wide. Check this stable capture before writing its reference.
      const actual = await captureStable(await capture());

      if (expected && matchesBaseline(actual, expected)) return;

      fence();
      await Bun.write(path, actual);
    };
    const matchesReference = async (expected: Buffer) => {
      const actual = await capture();

      if (actual.equals(expected)) return true;

      if (!matchesHorizontalShift(actual, expected)) return false;

      return matchesBaseline(await captureStable(actual), expected);
    };
    const compareOrUpdate = async () => {
      const path = baselinePath(profile, workflow, name);
      const reference = Bun.file(path);
      const expected = (await reference.exists())
        ? Buffer.from(await reference.arrayBuffer())
        : undefined;

      if (updating) return updateReference(path, expected);

      assertSnapshotComparison(info.config.updateSnapshots, info.project.ignoreSnapshots);

      if (expected && (await matchesReference(expected))) return;

      fence();
      const snapshotExpect = soft ? expect.soft : expect;

      await snapshotExpect(target === 'viewport' ? page : target).toHaveScreenshot(
        [profile, workflow, `${name}.png`],
        { timeout: remaining(), ...screenshotTolerance }
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
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

          if (focus !== 'preserve') {
            const entry = page.locator('.note-index-target[tabindex="-1"]:focus');

            if (await entry.count()) {
              fence();
              await entry.blur({ timeout: remaining() });
            }
          }

          fence();

          if (center) {
            await center.evaluate(
              (element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }),
              undefined,
              { timeout: remaining() }
            );
          }

          if (center && centerWithin) {
            const anchor = await center.boundingBox({ timeout: remaining() });

            if (!anchor) throw new Error(`Screenshot ${name} has no visible center anchor`);

            await centerWithin.evaluate(
              (element, anchorY) => {
                const { top, height } = element.getBoundingClientRect();
                const zoom = height / (element as HTMLElement).offsetHeight;

                // Correct fractional scroll drift after a root zoom change.
                element.scrollBy({ top: (anchorY - top - height / 2) / zoom, behavior: 'instant' });
              },
              anchor.y + anchor.height / 2,
              { timeout: remaining() }
            );
          }

          if (scrollToEnd) {
            fence();
            // Screenshot preparation can finish zoom layout before camera positioning.
            await page.screenshot({
              animations: 'disabled',
              caret: 'hide',
              scale: 'css',
              timeout: remaining()
            });
            fence();
            const layout = await scrollToEnd.evaluate(
              (element) => {
                element.scrollTop = element.scrollHeight;

                return {
                  scrollTop: element.scrollTop,
                  scrollHeight: element.scrollHeight,
                  clientHeight: element.clientHeight,
                  bounds: element.getBoundingClientRect().toJSON(),
                  contentBounds: element.firstElementChild?.getBoundingClientRect().toJSON(),
                  zoom: getComputedStyle(document.documentElement).zoom,
                  viewport: { width: innerWidth, height: innerHeight }
                };
              },
              undefined,
              { timeout: remaining() }
            );

            fence();
            await Bun.write(`${directory}/${name}-layout.json`, JSON.stringify(layout, null, 2));
          }

          fence();
          await compareOrUpdate();
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(timeout);
          }, remaining());
        })
      ]);

      if (updating && process.env.E2E_UPDATE_RUN) {
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

export function baselinePath(profile: string, workflow: string, name: string): string {
  return Bun.fileURLToPath(
    new URL(`../baselines/${profile}/${workflow}/${name}.png`, import.meta.url)
  );
}

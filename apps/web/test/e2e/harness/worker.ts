import { testStable } from '@study/testing/vitest';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';

/** One native worker fixture owns Chromium; a crashed process is replaced for the next attempt. */
export const testWeb = testStable.extend(
  'browserOwner',
  { scope: 'worker' },
  // Vitest requires destructuring for a fixture with no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  async ({}, { onCleanup }) => {
    let browser: Browser | undefined;

    onCleanup(async () => {
      await browser?.close();
    });

    return {
      async get() {
        if (!browser?.isConnected()) {
          browser = await chromium.launch();
          await Bun.write(
            `test-results/workers/${process.pid}-${crypto.randomUUID()}.json`,
            JSON.stringify({ pid: process.pid, browser: browser.version() })
          );
        }

        return browser;
      }
    };
  }
);

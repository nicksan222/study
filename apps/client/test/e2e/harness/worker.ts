import { testStable } from '@study/testing/vitest';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';

import { assertCapturePlatform } from './environment.ts';

/** One native worker fixture owns Chromium; a crashed process is replaced for the next attempt. */
export const testWeb = testStable.extend(
  'browserOwner',
  { scope: 'worker' },
  // Vitest requires destructuring for a fixture with no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  async ({}, { onCleanup }) => {
    let browser: Browser | undefined;
    const diagnostics: ReturnType<typeof Bun.file>[] = [];

    onCleanup(async () => {
      try {
        await browser?.close();
      } finally {
        await Promise.all(diagnostics.map((file) => file.delete()));
      }
    });

    return {
      async get() {
        assertCapturePlatform();

        if (!browser?.isConnected()) {
          browser = await chromium.launch();
          const diagnostic = Bun.file(
            `test-results/workers/${process.pid}-${crypto.randomUUID()}.json`
          );

          diagnostics.push(diagnostic);
          await Bun.write(
            diagnostic,
            JSON.stringify({ pid: process.pid, browser: browser.version() })
          );
        }

        return browser;
      }
    };
  }
);

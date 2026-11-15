import { testStable } from '@study/testing/vitest';
import type { Page } from 'playwright';
import { expect } from 'vite-plus/test';

import { safeName } from './identity.ts';
import { updateAllowed, requireScreenshots } from './screenshots.ts';
import { temporaryArtifacts } from './temporary.ts';

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
      await temporaryArtifacts(),
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

testStable(
  'canonical capture blurs only the passive focused entry after readiness unless preserved',
  async () => {
    const { screenshotAssertions } = await import('./screenshots.ts');

    for (const focus of [undefined, 'preserve'] as const) {
      for (const focusedEntry of [false, true]) {
        const calls: string[] = [];
        const page = {
          evaluate: async () => {
            calls.push('fonts');
          },
          locator: (selector: string) => ({
            evaluate: async () => {
              calls.push('images');
            },
            count: async () => {
              calls.push(selector);

              return Number(focusedEntry);
            },
            blur: async () => {
              calls.push('blur');
            }
          }),
          screenshot: async () => {
            throw new Error('capture reached');
          }
        };
        const screenshots = screenshotAssertions(
          page as unknown as Page,
          'focus',
          await temporaryArtifacts(),
          'contract'
        );

        await expect(
          screenshots.expectScreenshot('entry', {
            target: 'viewport',
            focus,
            ready: async () => {
              calls.push('ready');
            }
          })
        ).rejects.toThrow();
        expect(calls.slice(0, 3)).toEqual(['ready', 'fonts', 'images']);
        expect(calls.includes('blur')).toBe(focusedEntry && focus !== 'preserve');

        if (focus !== 'preserve') expect(calls[3]).toBe('.note-index-target[tabindex="-1"]:focus');
      }
    }
  }
);

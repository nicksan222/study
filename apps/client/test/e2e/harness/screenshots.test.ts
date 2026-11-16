import { test } from '@study/testing';
import type { Locator, Page } from 'playwright';

import { safeName } from './identity.ts';
import { updateAllowed, requireScreenshots } from './screenshots.ts';
import { temporaryArtifacts } from './temporary.ts';

const snapshotPolicy = {
  config: { updateSnapshots: 'none' as const },
  project: { ignoreSnapshots: false }
};

test.stable('screenshot paths and scoped baseline updates fail closed', () => {
  for (const name of ['../escape', '/absolute', '', 'a/b', 'x'.repeat(81)])
    test.expect(() => safeName(name)).toThrow();

  test.expect(safeName('editing-middle')).toBe('editing-middle');
  test
    .expect(
      updateAllowed('notes-edit-and-reopen', 'editing', {
        E2E_UPDATE: 'notes-edit-and-reopen/editing'
      })
    )
    .toBe(true);
  test
    .expect(
      updateAllowed('home-to-projects', 'editing', { E2E_UPDATE: 'notes-edit-and-reopen/editing' })
    )
    .toBe(false);
  test
    .expect(() =>
      updateAllowed('notes-edit-and-reopen', 'editing', {
        E2E_UPDATE: 'notes-edit-and-reopen',
        CI: 'true'
      })
    )
    .toThrow();
  test.expect(() => requireScreenshots(0)).toThrow('screenshot');
  test.expect(() => requireScreenshots(1)).not.toThrow();
});

test.stable('expired readiness stages cannot resume screenshot browser work', async () => {
  const { screenshotAssertions } = await import('./screenshots.ts');

  for (const stage of ['ready', 'fonts', 'images', 'center', 'render']) {
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
      locator: () => ({ evaluate: () => pause('images'), count: async () => 0 }),
      screenshot: async (options: { path?: string }) => {
        if (options.path) calls.push('diagnostic');
        else await pause('render');

        return Buffer.from([]);
      }
    };
    const screenshots = screenshotAssertions(
      page as unknown as Page,
      'late',
      await temporaryArtifacts(),
      'contract',
      snapshotPolicy
    );
    const pending = screenshots.expectScreenshot(stage, {
      target: 'viewport',
      ready: () => pause('ready'),
      center:
        stage === 'center'
          ? ({ evaluate: () => pause('center') } as unknown as Locator)
          : undefined,
      scrollToEnd: {
        evaluate: async () => {
          calls.push('scroll-end');
        }
      } as unknown as Locator,
      timeoutMs: 30
    });

    await reached.promise;
    await test.expect(pending).rejects.toThrow('timed out');
    test.expect(screenshots.captureMs).toBeGreaterThan(0);
    const atDeadline = [...calls];

    delayed.resolve();

    // Drain the finite harness continuation after the delayed promise resolves.
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();

    test.expect(calls).toEqual(atDeadline);
  }
});

test.stable(
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
          'contract',
          snapshotPolicy
        );

        await test
          .expect(
            screenshots.expectScreenshot('entry', {
              target: 'viewport',
              focus,
              ready: async () => {
                calls.push('ready');
              }
            })
          )
          .rejects.toThrow();
        test.expect(calls.slice(0, 3)).toEqual(['ready', 'fonts', 'images']);
        test.expect(calls.includes('blur')).toBe(focusedEntry && focus !== 'preserve');

        if (focus !== 'preserve')
          test.expect(calls[3]).toBe('.note-index-target[tabindex="-1"]:focus');
      }
    }
  }
);

test.stable.each(['all', 'changed'] as const)(
  'comparison rejects a native UI policy changed after fixture creation: %s',
  async (mode) => {
    const { screenshotAssertions } = await import('./screenshots.ts');
    const policy: Parameters<typeof screenshotAssertions>[4] = {
      config: { updateSnapshots: 'none' },
      project: { ignoreSnapshots: false }
    };
    const calls: string[] = [];
    const page = {
      evaluate: async () => {},
      locator: () => ({ evaluate: async () => {}, count: async () => 0 }),
      screenshot: async (options: { path?: string }) => {
        calls.push(options.path ? 'diagnostic' : 'capture');

        return Buffer.from([]);
      }
    };
    const screenshots = screenshotAssertions(
      page as unknown as Page,
      'ui-policy',
      await temporaryArtifacts(),
      'contract',
      policy
    );

    policy.config.updateSnapshots = mode;
    await test
      .expect(
        screenshots.expectScreenshot('blocked', { target: 'viewport', ready: async () => {} })
      )
      .rejects.toThrow('native snapshot overrides are forbidden');
    test.expect(calls).toEqual(['diagnostic']);
    test.expect(() => screenshots.verify()).toThrow('screenshot');
  }
);

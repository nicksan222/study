/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies integration launcher results and cleanup across failure conditions.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises child command execution with an isolated Docker protocol fixture.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests never start real provider software or use a Docker daemon.                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { test } from '@study/testing';

import { runIntegrationTests } from './environment.ts';
import { integrationFixture } from './fixture.ts';

test.stable.for(['success', 'test-failure'])(
  'integration execution preserves native reports and the %s exit code, then cleans up',
  async (mode, { expect }) => {
    await using context = await integrationFixture(mode);
    const code = await runIntegrationTests(context.root).catch(async (error) => {
      throw new Error(
        await Bun.file(`${context.root}/tooling/test-results/integrations/setup.log`).text(),
        { cause: error }
      );
    });

    expect(code).toBe(mode === 'success' ? 0 : 7);
    expect(await Bun.file(`${context.directory}/container`).exists()).toBe(false);
    expect(await Bun.file(`${context.directory}/image`).exists()).toBe(false);
    expect(
      await Bun.file(`${context.root}/tooling/test-results/vitest/integrations.xml`).text()
    ).toContain('provider imports');
    expect(
      await Bun.file(`${context.root}/tooling/test-results/integrations/provider.log`).text()
    ).toBe('provider diagnostics');
  }
);

test.stable.for([
  { mode: 'build-failure', error: 'build' },
  { mode: 'create-failure', error: 'create' },
  { mode: 'start-failure', error: 'invalid exit status' },
  { mode: 'report-failure', error: 'cp' }
])(
  'integration execution fails visibly and cleans up after $mode',
  async ({ mode, error }, { expect }) => {
    await using context = await integrationFixture(mode);

    await expect(runIntegrationTests(context.root)).rejects.toThrow(error);
    expect(await Bun.file(`${context.directory}/container`).exists()).toBe(false);
    expect(await Bun.file(`${context.directory}/image`).exists()).toBe(false);
    expect(
      await Bun.file(`${context.root}/tooling/test-results/integrations/setup.log`).exists()
    ).toBe(true);
  }
);

test.stable(
  'interrupted integration execution removes its container and image',
  async ({ waitFor, expect }) => {
    await using context = await integrationFixture('interrupt');
    const controller = new AbortController();
    const running = runIntegrationTests(context.root, controller.signal);

    void running.catch(() => {});

    try {
      await waitFor(async () =>
        expect(await Bun.file(`${context.directory}/started`).exists()).toBe(true)
      );

      controller.abort();
      await expect(running).rejects.toThrow();
      expect(await Bun.file(`${context.directory}/container`).exists()).toBe(false);
      expect(await Bun.file(`${context.directory}/image`).exists()).toBe(false);
    } finally {
      controller.abort();
      await running.catch(() => {});
    }
  }
);

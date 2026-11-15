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

import { testStable } from '@study/testing/vitest';
import { $ } from 'bun';
import { expect } from 'vite-plus/test';

import { runIntegrationTests } from './environment.ts';

async function fixture(mode = 'success') {
  const directory = (await $`mktemp -d`.quiet().text()).trim();
  const root = `${directory}/workspace`;

  for (const file of [
    'package.json',
    'bun.lock',
    'vite.config.ts',
    'packages/fixture.txt',
    'tooling/package.json',
    'apps/server/package.json',
    'apps/server/test/integrations/Dockerfile',
    'apps/client/package.json',
    'apps/desktop/package.json'
  ])
    await Bun.write(`${root}/${file}`, '{}');

  await Bun.write(
    `${directory}/docker`,
    `#!${process.execPath}
const base = ${JSON.stringify(directory)};
const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
const command = args[0];
if (command === 'build') {
  if (mode === 'build-failure') { console.error('fixture build failure'); process.exit(19); }
  await Bun.write(base + '/image', 'owned');
} else if (command === 'create') {
  await Bun.write(base + '/container', 'owned');
  if (mode === 'create-failure') process.exit(23);
} else if (command === 'start') {
  console.log('✓ imports a fixture note');
  await Bun.write(base + '/started', 'ready');
  if (mode === 'interrupt') await new Promise(() => setInterval(() => {}, 100));
  if (mode === 'test-failure') process.exit(7);
  if (mode === 'start-failure') process.exit(125);
} else if (command === 'inspect') {
  console.log(mode === 'start-failure' ? 'created 0' : mode === 'test-failure' ? 'exited 7' : 'exited 0');
} else if (command === 'cp') {
  if (mode === 'report-failure') process.exit(11);
  const target = args.at(-1);
  await Bun.write(target + '/vitest/integrations.xml', '<testsuite name="provider imports"/>');
  await Bun.write(target + '/integrations/provider.log', 'provider diagnostics');
} else if (command === 'ps' || command === 'images') {
  if (await Bun.file(base + (command === 'ps' ? '/container' : '/image')).exists()) console.log('owned');
} else if (command === 'rm') {
  await Bun.file(base + '/container').delete();
} else if (command === 'rmi') {
  await Bun.file(base + '/image').delete();
} else if (command !== 'stop') process.exit(99);
`
  );
  await $`chmod +x ${directory}/docker`.quiet();
  const previousPath = process.env.PATH;

  process.env.PATH = `${directory}:${previousPath}`;

  return {
    root,
    directory,
    async [Symbol.asyncDispose]() {
      process.env.PATH = previousPath;
      await $`rm -rf ${directory}`.quiet();
    }
  };
}

testStable.each(['success', 'test-failure'])(
  'integration execution preserves native reports and the %s exit code, then cleans up',
  async (mode) => {
    await using context = await fixture(mode);
    const code = await runIntegrationTests(context.root).catch(async (error) => {
      throw new Error(
        await Bun.file(`${context.root}/apps/server/test-results/integrations/setup.log`).text(),
        { cause: error }
      );
    });

    expect(code).toBe(mode === 'success' ? 0 : 7);
    expect(await Bun.file(`${context.directory}/container`).exists()).toBe(false);
    expect(await Bun.file(`${context.directory}/image`).exists()).toBe(false);
    expect(
      await Bun.file(`${context.root}/apps/server/test-results/vitest/integrations.xml`).text()
    ).toContain('provider imports');
    expect(
      await Bun.file(`${context.root}/apps/server/test-results/integrations/provider.log`).text()
    ).toBe('provider diagnostics');
  }
);

testStable.each([
  { mode: 'build-failure', error: 'build' },
  { mode: 'create-failure', error: 'create' },
  { mode: 'start-failure', error: 'invalid exit status' },
  { mode: 'report-failure', error: 'cp' }
])('integration execution fails visibly and cleans up after $mode', async ({ mode, error }) => {
  await using context = await fixture(mode);

  await expect(runIntegrationTests(context.root)).rejects.toThrow(error);
  expect(await Bun.file(`${context.directory}/container`).exists()).toBe(false);
  expect(await Bun.file(`${context.directory}/image`).exists()).toBe(false);
  expect(
    await Bun.file(`${context.root}/apps/server/test-results/integrations/setup.log`).exists()
  ).toBe(true);
});

testStable('interrupted integration execution removes its container and image', async () => {
  await using context = await fixture('interrupt');
  const controller = new AbortController();
  const running = runIntegrationTests(context.root, controller.signal);

  void running.catch(() => {});
  const deadline = AbortSignal.timeout(5000);

  try {
    while (!(await Bun.file(`${context.directory}/started`).exists())) {
      deadline.throwIfAborted();
      await Bun.sleep(10);
    }

    controller.abort();
    await expect(running).rejects.toThrow();
    expect(await Bun.file(`${context.directory}/container`).exists()).toBe(false);
    expect(await Bun.file(`${context.directory}/image`).exists()).toBe(false);
  } finally {
    controller.abort();
    await running.catch(() => {});
  }
});

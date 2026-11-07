/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs every provider scenario with mandatory disposable container teardown.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks fresh environments and cleanup after failed commands.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The scenario runs entirely inside Docker and its container is removed afterward.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { afterAll, beforeAll, expect } from 'vite-plus/test';

import { buildIntegrationImage, integrationContainerRemoved } from './environment.ts';
import { integrationFixtures } from './fixtures.ts';

let image: Awaited<ReturnType<typeof buildIntegrationImage>>;

const containers = new Set<string>();

beforeAll(async () => {
  image = await buildIntegrationImage();
}, 900000);
afterAll(async () => {
  await image?.close();
}, 60000);

const cases = Object.entries(integrationFixtures).flatMap(([provider, fixture]) =>
  ['success', 'failure'].map((outcome) => ({ provider, fixture, outcome }))
);

testStable.each(cases)(
  'runs $provider in a fresh environment and flushes it after $outcome',
  async ({ provider, fixture, outcome }) => {
    const container = await image.start(provider, fixture.executable);
    const id = container.getId();

    const expectedFailure = new Error('Intentional integration scenario failure');
    const run = async () => {
      try {
        expect(containers.has(id)).toBe(false);
        containers.add(id);
        const clean = await container.exec([
          'bun',
          '-e',
          "if(require('node:fs').readdirSync('/run/study-test').length) process.exit(1)"
        ]);

        expect(clean.exitCode, clean.output).toBe(0);
        const installed = await container.exec(['test', '-x', fixture.executable]);

        expect(installed.exitCode, `Missing installed provider: ${fixture.executable}`).toBe(0);
        const scenario = await container.exec([
          'xvfb-run',
          '-a',
          'bun',
          'test',
          '--timeout',
          '60000',
          `./apps/server/test/integrations/${fixture.scenario}`
        ]);

        expect(scenario.exitCode, scenario.output).toBe(0);

        if (outcome === 'failure') {
          const failure = await container.exec([
            'bun',
            '-e',
            "require('node:fs').writeFileSync('/run/study-test/dirty-state', 'discard me'); process.exit(23)"
          ]);

          expect(failure.exitCode).toBe(23);

          throw expectedFailure;
        }
      } finally {
        await container.stop({ timeout: 10000, remove: true, removeVolumes: true });
      }
    };

    if (outcome === 'failure') await expect(run()).rejects.toBe(expectedFailure);
    else await run();

    expect(await integrationContainerRemoved(id)).toBe(true);
  }
);

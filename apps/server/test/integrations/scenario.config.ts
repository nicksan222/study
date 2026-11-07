/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Selects the real application scenario inside a disposable test container.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Runs production import behavior with real desktop software.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only the Testcontainers runner may launch this container owned application scenario.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineConfig } from 'vite-plus';

import { integrationFixtures } from './fixtures.ts';

const fixture = integrationFixtures[process.env.STUDY_INTEGRATION_PROVIDER ?? ''];

if (!fixture) throw new Error('An integration container must select a registered provider');

/** The real application scenario runs only inside the disposable container. */
export default defineConfig({
  test: {
    name: 'integration-scenario',
    environment: 'node',
    include: [`apps/server/test/integrations/${fixture.scenario}`],
    testTimeout: 60000,
    hookTimeout: 30000,
    pool: 'forks',
    maxWorkers: 1
  }
});

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines explicit real provider tests using the shared container environment.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Separates external application tests from fast suites.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This explicit test command uses production Study runtime services without mocks.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineConfig } from 'vite-plus';

/** Explicit opt-in: Docker owns every real Obsidian process and its disposable test state. */
export default defineConfig({
  test: {
    name: 'integrations-testcontainers',
    environment: 'node',
    include: ['apps/server/test/integrations/integrations.e2e.ts'],
    testTimeout: 180000,
    hookTimeout: 900000,
    pool: 'forks',
    maxWorkers: 1
  }
});

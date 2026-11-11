/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Registers an isolated database fixture before each Vitest test and removes all     │
 * │ fixture databases after the test file completes.                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Registers each test with registerTest before execution and invokes cleanupTestFile     │
 * │   after the test file finishes.                                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Vitest runner imports this preload; it delegates fixture state to automatic.ts and       │
 * │ does not construct App itself.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { afterAll, beforeEach } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { cleanupTestFile, registerTest } from './automatic.ts';

beforeEach((t) => registerTest(t as TestContext));
afterAll(async () => {
  console.debug('study-test-phase:file-database-cleanup:start');
  await cleanupTestFile();
  console.debug('study-test-phase:file-database-cleanup:complete');
}, 30000);

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Registers an isolated database fixture before each Node test and removes all       │
 * │ fixture databases after the test file completes.                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Registers each test with registerTest before execution and invokes cleanupTestFile     │
 * │   after the test file finishes.                                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Node test runner imports this preload; it delegates fixture state to automatic.ts and    │
 * │ does not construct App itself.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { after, beforeEach } from 'node:test';
import type { TestContext } from 'node:test';

import { cleanupTestFile, registerTest } from './automatic.ts';

beforeEach((t) => registerTest(t as TestContext));
after(cleanupTestFile);

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises provider fixture acquisition failures and repeatable auth ownership      │
 * │ cleanup.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts partial acquisition releases resources before the next fixture starts.         │
 * │ - Asserts concurrent and repeated close calls release the process auth owner.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests acquire the real fixture and auth owner without bypassing singleton ownership.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';

import { documentTransformFixture } from './document-transform.ts';

testStable(
  'fixture acquisition failure releases peer/database and close releases auth exactly once',
  async () => {
    const owner = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });

    try {
      await expect(documentTransformFixture()).rejects.toThrow(/auth owner already exists/);
    } finally {
      await owner.dispose();
    }

    const first = await documentTransformFixture();

    try {
      await Promise.all([first.close(), first.close()]);
    } finally {
      await first.close();
    }

    const next = await documentTransformFixture();

    await next.close();
  }
);

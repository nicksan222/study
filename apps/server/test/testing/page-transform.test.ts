import { test } from '@study/testing';
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

import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';

import { pageTransformFixture } from './page-transform.ts';

test.stable(
  'fixture acquisition failure releases peer/database and close releases auth exactly once',
  async ({ databases, expect }) => {
    const owner = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });

    try {
      await expect(pageTransformFixture(databases)).rejects.toThrow(/auth owner already exists/);
    } finally {
      await owner.dispose();
    }

    const first = await pageTransformFixture(databases);

    try {
      await Promise.all([first.close(), first.close()]);
    } finally {
      await first.close();
    }

    const next = await pageTransformFixture(databases);

    await next.close();
  }
);

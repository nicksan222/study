/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks schema validation and JSON encoding for privately stored ChatGPT account    │
 * │ credentials. Malformed persisted values must be rejected.                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: stored account round trips and rejects malformed credentials.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/ai/auth/persistence directly with Vitest   ; no application or  │
 * │ database fixture is involved.                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { decodeAccount, encodeAccount } from '#server/platform/ai/auth/persistence';

testStable('stored account round trips and rejects malformed credentials', () => {
  const account = { subject: 'subject', clientId: 'client', refreshToken: null, sharing: true };

  expect(decodeAccount(encodeAccount(account))).toStrictEqual(account);
  assert.throws(() => decodeAccount({ ...account, refreshToken: 42 }));
});

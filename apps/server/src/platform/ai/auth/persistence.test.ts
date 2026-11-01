/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks schema validation and JSON encoding for privately stored ChatGPT account    │
 * │ credentials. Malformed persisted values must be rejected.                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: stored account round trips and rejects malformed credentials.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/ai/auth/persistence directly with node:test; no application or  │
 * │ database fixture is involved.                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeAccount, encodeAccount } from '#server/platform/ai/auth/persistence';

test('stored account round trips and rejects malformed credentials', () => {
  const account = { subject: 'subject', clientId: 'client', refreshToken: null, sharing: true };

  assert.deepEqual(decodeAccount(encodeAccount(account)), account);
  assert.throws(() => decodeAccount({ ...account, refreshToken: 42 }));
});

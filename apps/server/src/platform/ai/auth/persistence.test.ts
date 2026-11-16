import { test } from '@study/testing';
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

import { decodeAccount, encodeAccount } from '#server/platform/ai/auth/persistence';

test.unit.stable(
  'stored account round trips and rejects malformed credentials',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const account = { subject: 'subject', clientId: 'client', refreshToken: null, sharing: true };

    expect(decodeAccount(encodeAccount(account))).toStrictEqual(account);
    assert.throws(() => decodeAccount({ ...account, refreshToken: 42 }));
  }
);

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeAccount, encodeAccount } from '#server/platform/ai/auth/persistence';

test('stored account round trips and rejects malformed credentials', () => {
  const account = { subject: 'subject', clientId: 'client', refreshToken: null, sharing: true };

  assert.deepEqual(decodeAccount(encodeAccount(account)), account);
  assert.throws(() => decodeAccount({ ...account, refreshToken: 42 }));
});

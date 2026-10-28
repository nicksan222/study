import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setPreference as dbSetPreference } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';
test('connections returns only public account fields from persisted credentials', async (t) => {
  const f = await createBackendTest(t);

  const signedOut = await f.caller.auth.connections({});

  assert.equal(Object.hasOwn(signedOut, 'chatgpt'), true);
  assert.equal(signedOut.chatgpt, undefined);
  dbSetPreference(f.store, 'private.chatgpt', 'account', {
    subject: 'subject-without-email',
    sharing: false,
    refreshToken: 'private',
    clientId: 'client'
  });
  const accountWithoutEmail = await f.caller.auth.connections({});

  assert.equal(Object.hasOwn(accountWithoutEmail.chatgpt!, 'email'), true);
  assert.equal(accountWithoutEmail.chatgpt?.email, undefined);
  dbSetPreference(f.store, 'private.chatgpt', 'account', {
    subject: 'subject',
    email: 'student@example.test',
    sharing: true,
    refreshToken: 'private',
    clientId: 'client'
  });
  const result = await f.caller.auth.connections({});

  assert.equal(Object.hasOwn(result, 'chatgpt'), true);
  assert.equal(Object.hasOwn(result.chatgpt!, 'email'), true);
  assert.equal(result.chatgpt?.subject, 'subject');
  assert.equal(result.chatgpt?.email, 'student@example.test');
  assert.equal(result.chatgpt?.sharing, true);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setPreference as dbSetPreference } from '#backend/procedures/settings/preferences';
import { fixture } from '#testing/procedures';
test('connections returns only public account fields from persisted credentials', async (t) => {
  const f = await fixture(t);

  assert.equal((await f.caller.auth.connections({})).chatgpt, undefined);
  dbSetPreference(f.store, 'private.chatgpt', 'account', {
    subject: 'subject',
    email: 'student@example.test',
    sharing: true,
    refreshToken: 'private',
    clientId: 'client'
  });
  const result = await f.caller.auth.connections({});

  assert.equal(result.chatgpt?.subject, 'subject');
  assert.equal(result.chatgpt?.email, 'student@example.test');
  assert.equal(result.chatgpt?.sharing, true);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

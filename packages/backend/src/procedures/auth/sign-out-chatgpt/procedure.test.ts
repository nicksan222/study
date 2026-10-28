import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  loadPreferences as dbLoadPreferences,
  setPreference as dbSetPreference
} from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';
test('signOutChatgpt deletes saved credentials and cancels pending sign-in', async (t) => {
  const f = await createBackendTest(t);

  dbSetPreference(f.store, 'private.chatgpt', 'account', {
    subject: 'student',
    refreshToken: 'private',
    clientId: 'client',
    sharing: false
  });
  const pending = await f.app.startSignIn();

  await f.caller.auth.signOutChatgpt({});
  assert.equal(f.app.publicAccount(), undefined);
  assert.equal(dbLoadPreferences(f.store, 'private.chatgpt').account, undefined);
  assert.equal(f.app.cancelSignIn(pending.attemptId), false);
  await f.caller.auth.signOutChatgpt({});
});

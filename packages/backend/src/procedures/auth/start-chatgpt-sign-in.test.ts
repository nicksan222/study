import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';
test('startChatgptSignIn creates fresh attempts and forwards reconsent to the real OAuth flow', async (t) => {
  const f = await fixture(t);
  const one = await f.caller.auth.startChatgptSignIn({
    reconsent: false
  });

  assert.ok(one.attemptId);
  assert.equal(new URL(one.url).hostname, 'auth.openai.com');
  const two = await f.caller.auth.startChatgptSignIn({
    reconsent: true
  });

  assert.notEqual(two.attemptId, one.attemptId);
  assert.equal(new URL(two.url).searchParams.get('force_reconsent'), 'true');
  assert.equal(f.app.cancelSignIn(one.attemptId), false);
  assert.equal(f.app.cancelSignIn(two.attemptId), true);
});

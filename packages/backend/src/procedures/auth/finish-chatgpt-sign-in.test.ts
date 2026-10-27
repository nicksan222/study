import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadPreferences as dbLoadPreferences } from '#backend/procedures/settings/preferences';
import { fixture } from '#testing/procedures';
test('finishChatgptSignIn rejects missing and stale attempts without saving credentials', async (t) => {
  const f = await fixture(t);

  await assert.rejects(f.caller.auth.finishChatgptSignIn({} as never), {
    kind: 'invalid_input'
  });
  await assert.rejects(
    f.caller.auth.finishChatgptSignIn({
      attemptId: 'unknown'
    }),
    {
      kind: 'invalid_input'
    }
  );
  const attempt = await f.app.startSignIn();

  f.app.cancelSignIn(attempt.attemptId);
  await assert.rejects(
    f.caller.auth.finishChatgptSignIn({
      attemptId: attempt.attemptId
    }),
    {
      kind: 'invalid_input'
    }
  );
  assert.equal(f.app.publicAccount(), undefined);
  assert.equal(dbLoadPreferences(f.store, 'private.chatgpt').account, undefined);
});
test('finishChatgptSignIn forwards request cancellation and never saves an aborted attempt', async (t) => {
  const f = await fixture(t);
  const attempt = await f.app.startSignIn();
  const controller = new AbortController();
  const pending = f.callerFor(controller.signal).auth.finishChatgptSignIn({
    attemptId: attempt.attemptId
  });
  const rejected = assert.rejects(Promise.resolve(pending));

  controller.abort();
  await rejected;
  assert.equal(f.app.publicAccount(), undefined);
  assert.equal(dbLoadPreferences(f.store, 'private.chatgpt').account, undefined);
});

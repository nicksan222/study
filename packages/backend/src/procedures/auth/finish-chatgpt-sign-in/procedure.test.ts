import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadPreferences as dbLoadPreferences } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';
test('finishChatgptSignIn rejects missing and stale attempts without saving credentials', async (t) => {
  const f = await createBackendTest(t);

  const missingAttempt = { attemptId: 'unknown' };

  Reflect.deleteProperty(missingAttempt, 'attemptId');
  await assert.rejects(f.caller.auth.finishChatgptSignIn(missingAttempt), {
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
  const f = await createBackendTest(t);
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

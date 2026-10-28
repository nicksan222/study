import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';
test('cancelChatgptSignIn validates attempt identity and closes the pending OAuth listener', async (t) => {
  const f = await createBackendTest(t);

  const missingAttempt = { attemptId: 'unknown' };

  Reflect.deleteProperty(missingAttempt, 'attemptId');
  await assert.rejects(f.caller.auth.cancelChatgptSignIn(missingAttempt), {
    kind: 'invalid_input'
  });
  const attempt = await f.app.startSignIn();

  assert.equal(
    (
      await f.caller.auth.cancelChatgptSignIn({
        attemptId: 'wrong'
      })
    ).value,
    false
  );
  assert.equal(
    (
      await f.caller.auth.cancelChatgptSignIn({
        attemptId: attempt.attemptId
      })
    ).value,
    true
  );
  assert.equal(
    (
      await f.caller.auth.cancelChatgptSignIn({
        attemptId: attempt.attemptId
      })
    ).value,
    false
  );
  await assert.rejects(f.app.finishSignIn(undefined, attempt.attemptId));
  assert.equal(f.app.publicAccount(), undefined);
});

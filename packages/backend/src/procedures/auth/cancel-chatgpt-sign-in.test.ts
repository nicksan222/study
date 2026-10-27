import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';
test('cancelChatgptSignIn validates attempt identity and closes the pending OAuth listener', async (t) => {
  const f = await fixture(t);

  await assert.rejects(f.caller.auth.cancelChatgptSignIn({} as never), {
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

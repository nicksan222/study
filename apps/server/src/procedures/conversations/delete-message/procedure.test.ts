import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { postMessage as opPostMessage } from '#server/procedures/conversations/operations/post-message';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createServerTest } from '#testing/server-test';
test('deleteMessage removes a stored message', async (t) => {
  const f = await createServerTest(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const m = opPostMessage(f.store, {
    sessionId: s.id,
    text: 'Hello'
  });

  assert.equal(
    (
      await f.caller.conversations.deleteMessage({
        id: m.id
      })
    ).value,
    true
  );
  assert.equal(
    (
      await f.caller.conversations.deleteMessage({
        id: m.id
      })
    ).value,
    false
  );
});

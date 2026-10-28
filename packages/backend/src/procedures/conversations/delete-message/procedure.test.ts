import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/operations/post-message';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';
test('deleteMessage removes a stored message', async (t) => {
  const f = await createBackendTest(t);
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

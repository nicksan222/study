import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createSession as opCreateSession } from './create-session.ts';
import { postMessage as opPostMessage } from './post-message.ts';
test('deleteMessage removes a stored message', async (t) => {
  const f = await fixture(t);
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

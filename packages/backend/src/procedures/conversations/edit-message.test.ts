import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createSession as opCreateSession } from './create-session.ts';
import { message as opMessage } from './messages.ts';
import { postMessage as opPostMessage } from './post-message.ts';
test('editMessage creates an active edited version', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const m = opPostMessage(f.store, {
    sessionId: s.id,
    text: 'Old'
  });

  await f.caller.conversations.editMessage({
    id: m.id,
    text: 'New'
  });
  assert.equal(
    opMessage(f.store, m.id)?.versions.find(
      (v) => v.id === opMessage(f.store, m.id)?.activeVersionId
    )?.text,
    'New'
  );
  assert.equal(
    (
      await f.caller.conversations.editMessage({
        id: 999999n,
        text: 'Missing'
      })
    ).value,
    null
  );
});

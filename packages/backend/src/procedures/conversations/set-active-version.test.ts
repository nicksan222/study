import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createSession as opCreateSession } from './create-session.ts';
import { editMessage as opEditMessage } from './edit-message.ts';
import { message as opMessage } from './messages.ts';
import { postMessage as opPostMessage } from './post-message.ts';
test('setActiveVersion selects a complete version', async (t) => {
  const f = await fixture(t);
  const s = opCreateSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');
  const m = opPostMessage(f.store, {
    sessionId: s.id,
    text: 'Original'
  });
  const edited = opEditMessage(f.store, m.id, 'Edited');

  assert.ok(edited);
  const out = await f.caller.conversations.setActiveVersion({
    message: m.id,
    version: edited
  });

  assert.equal(out.value, true);
  assert.equal(
    opMessage(f.store, m.id)?.versions.find(
      (v) => v.id === opMessage(f.store, m.id)?.activeVersionId
    )?.text,
    'Edited'
  );
  assert.equal(
    (
      await f.caller.conversations.setActiveVersion({
        message: m.id,
        version: 999999n
      })
    ).value,
    false
  );
  assert.equal(
    (
      await f.caller.conversations.setActiveVersion({
        message: m.id,
        version: m.activeVersionId!
      })
    ).value,
    true
  );
  assert.equal(opMessage(f.store, m.id)?.activeVersionId, m.activeVersionId);
});

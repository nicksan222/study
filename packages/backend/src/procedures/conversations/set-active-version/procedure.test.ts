import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { editMessage as opEditMessage } from '#backend/procedures/conversations/operations/edit-message';
import { message as opMessage } from '#backend/procedures/conversations/operations/messages';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/operations/post-message';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';
test('setActiveVersion selects a complete version', async (t) => {
  const f = await createBackendTest(t);
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

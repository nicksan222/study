import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { message as opMessage } from '#backend/procedures/conversations/operations/messages';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/operations/post-message';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';
test('editMessage creates an active edited version', async (t) => {
  const f = await createBackendTest(t);
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

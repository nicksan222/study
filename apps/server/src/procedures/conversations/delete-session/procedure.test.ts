import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as dbCreateSession } from '#server/procedures/conversations/operations/create-session';
import { session as dbSession } from '#server/procedures/conversations/operations/session';
import { createProject as dbCreateProject } from '#server/procedures/projects/operations/create-project';
import { createServerTest } from '#testing/server-test';
test('deleteSession removes the session', async (t) => {
  const f = await createServerTest(t);
  const s = dbCreateSession(f.store, dbCreateProject(f.store, 'One').id, 'Chat');

  assert.equal(
    (
      await f.caller.conversations.deleteSession({
        id: s.id
      })
    ).value,
    true
  );
  assert.equal(dbSession(f.store, s.id), null);
  assert.equal(
    (
      await f.caller.conversations.deleteSession({
        id: s.id
      })
    ).value,
    false
  );
});

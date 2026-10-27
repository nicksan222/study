import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createSession as dbCreateSession } from './create-session.ts';
import { session as dbSession } from './session.ts';
test('deleteSession removes the session', async (t) => {
  const f = await fixture(t);
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

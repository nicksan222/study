import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createSession as dbCreateSession } from './create-session.ts';
test('session returns stored session and empty missing result', async (t) => {
  const f = await fixture(t);
  const s = dbCreateSession(f.store, dbCreateProject(f.store, 'One').id, 'Chat');

  assert.equal(
    (
      await f.caller.conversations.session({
        id: s.id
      })
    ).value?.title,
    'Chat'
  );
  assert.equal(
    (
      await f.caller.conversations.session({
        id: 999999n
      })
    ).value,
    null
  );
});

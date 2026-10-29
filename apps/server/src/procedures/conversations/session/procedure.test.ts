import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as dbCreateSession } from '#server/procedures/conversations/operations/create-session';
import { createProject as dbCreateProject } from '#server/procedures/projects/operations/create-project';
import { createServerTest } from '#testing/server-test';
test('session returns stored session and empty missing result', async (t) => {
  const f = await createServerTest(t);
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

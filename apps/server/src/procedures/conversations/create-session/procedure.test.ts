import assert from 'node:assert/strict';
import test from 'node:test';

import { listAllSessions as dbListAllSessions } from '#server/procedures/conversations/operations/all-sessions';
import { createProject as dbCreateProject } from '#server/procedures/projects/operations/create-project';
import { createServerTest } from '#testing/server-test';
test('createSession persists the requested title', async (t) => {
  const f = await createServerTest(t);
  const p = dbCreateProject(f.store, 'One');
  const out = await f.caller.conversations.createSession({
    project: p.id,
    title: 'Review'
  });

  assert.equal(
    dbListAllSessions(f.store).some((session) => session.title === 'Review'),
    true
  );
  assert.equal(out.title, 'Review');
  assert.equal(out.projectId, p.id);
  await assert.rejects(
    f.caller.conversations.createSession({
      project: 999999n,
      title: 'Missing'
    })
  );
});

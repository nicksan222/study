import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { listAllSessions as dbListAllSessions } from './all-sessions.ts';
test('createSession persists the requested title', async (t) => {
  const f = await fixture(t);
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

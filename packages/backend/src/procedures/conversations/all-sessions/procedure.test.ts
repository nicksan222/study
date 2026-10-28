import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as dbCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { createProject as dbCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';
test('allSessions lists persisted sessions', async (t) => {
  const f = await createBackendTest(t);
  const p = dbCreateProject(f.store, 'One');
  const s = dbCreateSession(f.store, p.id, 'Chat');
  const out = await f.caller.conversations.allSessions({});

  assert.deepEqual(
    out.items.map((x) => x.id),
    [s.id]
  );
});

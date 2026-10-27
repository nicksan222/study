import assert from 'node:assert/strict';
import test from 'node:test';

import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createSession as dbCreateSession } from './create-session.ts';
test('allSessions lists persisted sessions', async (t) => {
  const f = await fixture(t);
  const p = dbCreateProject(f.store, 'One');
  const s = dbCreateSession(f.store, p.id, 'Chat');
  const out = await f.caller.conversations.allSessions({});

  assert.deepEqual(
    out.items.map((x) => x.id),
    [s.id]
  );
});

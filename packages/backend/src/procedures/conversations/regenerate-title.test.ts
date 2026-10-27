import assert from 'node:assert/strict';
import test from 'node:test';

import { listJobs as dbListJobs } from '#backend/procedures/jobs/job-overviews';
import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createSession as dbCreateSession } from './create-session.ts';
test('regenerateTitle enqueues title work', async (t) => {
  const f = await fixture(t);
  const s = dbCreateSession(f.store, dbCreateProject(f.store, 'One').id, 'Chat');
  const out = await f.caller.conversations.regenerateTitle({
    id: s.id
  });

  assert.ok(out.id);
  assert.equal(
    dbListJobs(f.store).some(
      (j) => j.kind === 'title' && j.target.type === 'session' && j.target.id === s.id
    ),
    true
  );
  await assert.rejects(
    f.caller.conversations.regenerateTitle({
      id: 999999n
    }),
    (error: { kind?: string }) => error.kind === 'not_found'
  );
});

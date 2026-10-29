import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession as dbCreateSession } from '#server/procedures/conversations/operations/create-session';
import { listJobs as dbListJobs } from '#server/procedures/jobs/operations/job-overviews';
import { createProject as dbCreateProject } from '#server/procedures/projects/operations/create-project';
import { createServerTest } from '#testing/server-test';
test('regenerateTitle enqueues title work', async (t) => {
  const f = await createServerTest(t);
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

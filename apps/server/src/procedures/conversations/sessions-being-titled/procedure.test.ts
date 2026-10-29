import assert from 'node:assert/strict';
import test from 'node:test';

import { createUntitledSession as opCreateUntitledSession } from '#server/procedures/conversations/operations/create-untitled-session';
import { cancelJob as opCancelJob } from '#server/procedures/jobs/operations/cancel-job';
import { listJobs as opListJobs } from '#server/procedures/jobs/operations/job-overviews';
import { enqueueJob as opEnqueueJob } from '#server/procedures/jobs/worker';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createServerTest } from '#testing/server-test';
test('sessionsBeingTitled lists queued title targets', async (t) => {
  const f = await createServerTest(t);
  const s = opCreateUntitledSession(f.store, opCreateProject(f.store, 'One').id, 'Chat');

  opEnqueueJob(f.store, {
    kind: 'title',
    target: {
      type: 'session',
      id: s.id
    }
  });
  const out = await f.caller.conversations.sessionsBeingTitled({});

  assert.deepEqual(out.items, [s.id]);
  const title = opListJobs(f.store).find((j) => j.kind === 'title')!;

  opCancelJob(f.store, title.id);
  assert.deepEqual((await f.caller.conversations.sessionsBeingTitled({})).items, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { cancelJob as opCancelJob } from '#backend/procedures/jobs/cancel-job';
import { listJobs as opListJobs } from '#backend/procedures/jobs/job-overviews';
import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createUntitledSession as opCreateUntitledSession } from './create-untitled-session.ts';
test('sessionsBeingTitled lists queued title targets', async (t) => {
  const f = await fixture(t);
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

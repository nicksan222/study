import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { cancelJob } from '#backend/procedures/jobs/operations/cancel-job';
import { job as opJob } from '#backend/procedures/jobs/operations/job';
import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';

test('retryJob requeues cancelled work', async (t) => {
  const f = await createBackendTest(t);
  const p = opCreateProject(f.store, 'P'),
    s = opCreateSession(f.store, p.id, 'S');
  const id = opEnqueueJob(f.store, {
    kind: 'title',
    target: {
      type: 'session',
      id: s.id
    }
  });

  cancelJob(f.store, id);
  assert.equal((await f.caller.jobs.retryJob({ id })).value, true);
  assert.equal(opJob(f.store, id)?.status, 'queued');
  assert.equal((await f.caller.jobs.retryJob({ id })).value, false);
  assert.equal((await f.caller.jobs.retryJob({ id: 999n })).value, false);
  await assert.rejects(f.caller.jobs.retryJob({ id: 0n }), {
    kind: 'invalid_input'
  });
});

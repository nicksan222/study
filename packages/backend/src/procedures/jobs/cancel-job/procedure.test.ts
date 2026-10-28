import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { job as opJob } from '#backend/procedures/jobs/operations/job';
import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';

test('cancelJob persists cancellation and reports missing or terminal jobs', async (t) => {
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

  assert.equal((await f.caller.jobs.cancelJob({ id })).value, true);
  assert.equal(opJob(f.store, id)?.status, 'cancelled');
  assert.equal((await f.caller.jobs.cancelJob({ id })).value, false);
  assert.equal((await f.caller.jobs.cancelJob({ id: 999n })).value, false);
  const missingId = { id };

  Reflect.deleteProperty(missingId, 'id');
  await assert.rejects(f.caller.jobs.cancelJob(missingId), {
    kind: 'invalid_input'
  });
});

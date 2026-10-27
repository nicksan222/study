import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { job as opJob } from './job.ts';
import { enqueueJob as opEnqueueJob } from './worker.ts';
test('cancelJob persists cancellation and reports missing or terminal jobs', async (t) => {
  const f = await fixture(t);
  const p = opCreateProject(f.store, 'P'),
    s = opCreateSession(f.store, p.id, 'S');
  const id = opEnqueueJob(f.store, {
    kind: 'title',
    target: {
      type: 'session',
      id: s.id
    }
  });

  assert.equal(
    (
      await f.caller.jobs.cancelJob({
        id: id
      })
    ).value,
    true
  );
  assert.equal(opJob(f.store, id)?.status, 'cancelled');
  assert.equal(
    (
      await f.caller.jobs.cancelJob({
        id: id
      })
    ).value,
    false
  );
  assert.equal(
    (
      await f.caller.jobs.cancelJob({
        id: 999n
      })
    ).value,
    false
  );
  await assert.rejects(f.caller.jobs.cancelJob({} as never), {
    kind: 'invalid_input'
  });
});

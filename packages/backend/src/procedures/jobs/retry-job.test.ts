import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { cancelJob as opCancelJob } from './cancel-job.ts';
import { job as opJob } from './job.ts';
import { enqueueJob as opEnqueueJob } from './worker.ts';
test('retryJob requeues cancelled work', async (t) => {
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

  opCancelJob(f.store, id);
  assert.equal(
    (
      await f.caller.jobs.retryJob({
        id: id
      })
    ).value,
    true
  );
  assert.equal(opJob(f.store, id)?.status, 'queued');
  assert.equal(
    (
      await f.caller.jobs.retryJob({
        id: id
      })
    ).value,
    false
  );
  assert.equal(
    (
      await f.caller.jobs.retryJob({
        id: 999n
      })
    ).value,
    false
  );
  await assert.rejects(
    f.caller.jobs.retryJob({
      id: 0n
    }),
    {
      kind: 'invalid_input'
    }
  );
});

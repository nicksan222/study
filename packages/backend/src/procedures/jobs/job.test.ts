import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { enqueueJob as opEnqueueJob } from './worker.ts';
test('job exposes persisted status and returns no value for missing jobs', async (t) => {
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
  const result = await f.caller.jobs.job({
    id: id
  });

  assert.equal(result.value?.id, id);
  assert.equal(result.value?.status, 'queued');
  assert.equal(
    (
      await f.caller.jobs.job({
        id: 999n
      })
    ).value,
    null
  );
  await assert.rejects(
    f.caller.jobs.job({
      id: -1n
    }),
    {
      kind: 'invalid_input'
    }
  );
});

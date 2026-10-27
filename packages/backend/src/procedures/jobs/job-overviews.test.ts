import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/create-note';
import { fixture } from '#testing/procedures';

import { cancelJob } from './cancel-job.ts';
import { targetJobs } from './job-overviews.ts';
import { enqueueJob as opEnqueueJob } from './worker.ts';
test('jobOverviews joins source, document and session ownership and bounds the list', async (t) => {
  const f = await fixture(t);

  assert.deepEqual((await f.caller.jobs.jobOverviews({})).items, []);
  const p = opCreateProject(f.store, 'Physics'),
    s = opCreateSession(f.store, p.id, 'Notes'),
    source = opCreateNote(f.store, 'Lecture', 'Gravity', p.id);

  opEnqueueJob(f.store, {
    kind: 'extract',
    target: {
      type: 'source',
      id: source.id
    }
  });
  opEnqueueJob(f.store, {
    kind: 'title',
    target: {
      type: 'session',
      id: s.id
    }
  });
  const items = (await f.caller.jobs.jobOverviews({})).items;

  assert.equal(items.length, 2);
  const sourceItem = items.find((i) => i.sourceId === source.id)!;

  assert.equal(sourceItem.subject, 'Lecture');
  assert.equal(sourceItem.projectName, 'Physics');
  assert.equal(items.find((i) => i.sessionId === s.id)?.sessionTitle, 'Notes');
  assert.equal(
    (
      await f.caller.jobs.jobOverviews({
        limit: 1
      })
    ).items.length,
    1
  );
  await assert.rejects(
    f.caller.jobs.jobOverviews({
      limit: 10001
    }),
    {
      kind: 'invalid_input'
    }
  );
});

test('target jobs stay scoped to their target column and newest first', async (t) => {
  const f = await fixture(t);
  const project = opCreateProject(f.store, 'Physics');
  const session = opCreateSession(f.store, project.id, 'Chat');
  const source = opCreateNote(f.store, 'Notes', 'Body', project.id);
  const other = opCreateNote(f.store, 'Other', 'Body', project.id);
  const first = opEnqueueJob(f.store, {
    kind: 'extract',
    target: { type: 'source', id: source.id }
  });

  cancelJob(f.store, first);
  const latest = opEnqueueJob(f.store, {
    kind: 'extract',
    target: { type: 'source', id: source.id }
  });
  const title = opEnqueueJob(f.store, {
    kind: 'title',
    target: { type: 'session', id: session.id }
  });

  opEnqueueJob(f.store, { kind: 'extract', target: { type: 'source', id: other.id } });

  assert.deepEqual(
    targetJobs(f.store, 'source', source.id).map((job) => job.id),
    [latest, first]
  );
  assert.deepEqual(
    targetJobs(f.store, 'session', session.id).map((job) => job.id),
    [title]
  );
  assert.deepEqual(targetJobs(f.store, 'source', 999999n), []);
});

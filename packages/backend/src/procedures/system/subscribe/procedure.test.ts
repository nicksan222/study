import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enqueueJob } from '#backend/procedures/jobs/worker';
import { createProject } from '#backend/procedures/projects/operations/create-project';
import { createNote } from '#backend/procedures/sources/operations/create-note';
import { source as readSource } from '#backend/procedures/sources/operations/source';
import { createBackendTest } from '#testing/backend-test';
test('subscribe emits committed refreshes and ends on request cancellation', async (t) => {
  const f = await createBackendTest(t);
  const controller = new AbortController();
  const stream = (await f.callerFor(controller.signal).system.subscribe())[Symbol.asyncIterator]();

  assert.deepEqual((await stream.next()).value, {
    type: 'refresh'
  });
  const next = stream.next();
  const source = f.store.transaction(() => {
    const project = createProject(f.store, 'Committed');
    const source = createNote(f.store, 'Lecture', 'Gravity', project.id);

    enqueueJob(f.store, {
      kind: 'extract',
      target: {
        type: 'source',
        id: source.id
      }
    });

    return source;
  });

  assert.deepEqual((await next).value, {
    type: 'refresh'
  });
  assert.equal(readSource(f.store, source.id)?.name, 'Lecture');
  const stopped = stream.next();

  controller.abort();
  assert.equal((await stopped).done, true);
  assert.equal((await stream.next()).done, true);
});
test('subscribe starts aborted requests without yielding', async (t) => {
  const f = await createBackendTest(t);
  const controller = new AbortController();

  controller.abort();
  const stream = (await f.callerFor(controller.signal).system.subscribe())[Symbol.asyncIterator]();

  assert.equal((await stream.next()).done, true);
});

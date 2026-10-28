import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPractice as opCreatePractice } from '#backend/procedures/practice/operations/project-practice';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';

test('practices lists each persisted practice with its project', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const first = opCreatePractice(f.store, project.id);
  const second = opCreatePractice(f.store, opCreateProject(f.store, 'Chemistry').id);
  const result = await f.caller.practice.practices({});

  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((item) => item.id),
    [second.id, first.id]
  );
});

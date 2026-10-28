import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as dbCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';
test('projects returns persisted rows with exact bigint IDs and an empty initial list', async (t) => {
  const f = await createBackendTest(t);

  assert.deepEqual((await f.caller.projects.projects({})).items, []);
  const p = dbCreateProject(f.store, 'Physics');
  const result = await f.caller.projects.projects({});

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.id, p.id);
  assert.equal(result.items[0]?.name, 'Physics');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  listProjects as dbListProjects,
  project as dbProject
} from '#backend/procedures/projects/operations/read-projects';
import { createBackendTest } from '#testing/backend-test';
test('createProject persists normalized names and rejects blank input', async (t) => {
  const f = await createBackendTest(t);
  const result = await f.caller.projects.createProject({
    name: ' Physics '
  });

  assert.equal(result.name, 'Physics');
  assert.equal(dbProject(f.store, result.id)?.name, 'Physics');
  await assert.rejects(
    f.caller.projects.createProject({
      name: '  '
    }),
    {
      kind: 'invalid_input'
    }
  );
  assert.equal(dbListProjects(f.store).length, 1);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listPractices as opListPractices } from '#backend/procedures/practice/operations/practices';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';

test('projectPractice creates a practice for the project', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const result = await f.caller.practice.projectPractice({ id: BigInt(project.id) });

  assert.ok(result.id > 0n);
  assert.equal(
    opListPractices(f.store).find((practice) => practice.id === result.id)?.projectId,
    project.id
  );
});

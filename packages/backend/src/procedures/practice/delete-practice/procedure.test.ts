import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPractice as opCreatePractice } from '#backend/procedures/practice/operations/project-practice';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';

test('deletePractice removes a practice and reports false when it is already missing', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const practice = opCreatePractice(f.store, project.id);

  assert.equal(
    (
      await f.caller.practice.deletePractice({
        id: BigInt(practice.id)
      })
    ).value,
    true
  );
  assert.equal(
    (
      await f.caller.practice.deletePractice({
        id: BigInt(practice.id)
      })
    ).value,
    false
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createPractice as opCreatePractice } from './project-practice.ts';
test('deletePractice removes a practice and reports false when it is already missing', async (t) => {
  const f = await fixture(t);
  const project = opCreateProject(f.store, 'Physics');
  const p = opCreatePractice(f.store, project.id);
  const result = await f.caller.practice.deletePractice({
    id: BigInt(p.id)
  });

  assert.equal(result.value, true);
  assert.equal(
    (
      await f.caller.practice.deletePractice({
        id: BigInt(p.id)
      })
    ).value,
    false
  );
});

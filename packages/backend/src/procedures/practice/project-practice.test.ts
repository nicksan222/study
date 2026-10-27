import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { listPractices as opListPractices } from './practices.ts';
test('projectPractice creates a practice for the project', async (t) => {
  const f = await fixture(t);
  const project = opCreateProject(f.store, 'Physics');
  const result = await f.caller.practice.projectPractice({
    id: BigInt(project.id)
  });

  assert.ok(result.id > 0n);
  assert.equal(
    opListPractices(f.store).find((practice) => practice.id === result.id)?.projectId,
    project.id
  );
});

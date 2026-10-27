import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture, completeMaterial } from '#testing/procedures';

import { artifact as opArtifact } from './artifact.ts';
test('deleteMaterial removes matching artifacts and becomes idempotently false', async (t) => {
  const f = await fixture(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeMaterial(f.store, project.id);
  const result = await f.caller.material.deleteMaterial({
    project: BigInt(project.id),
    kind: 'flashcards'
  });

  assert.equal(result.value, true);
  assert.equal(
    (
      await f.caller.material.deleteMaterial({
        project: BigInt(project.id),
        kind: 'flashcards'
      })
    ).value,
    false
  );
  assert.equal(opArtifact(f.store, made.artifactId), null);
  await assert.rejects(
    f.caller.material.deleteMaterial({
      project: project.id,
      kind: 0
    } as never),
    {
      kind: 'invalid_input'
    }
  );
});

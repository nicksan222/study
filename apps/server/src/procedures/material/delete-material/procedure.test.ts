import assert from 'node:assert/strict';
import { test } from 'node:test';

import { artifact as opArtifact } from '#server/procedures/material/operations/artifact';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { completeMaterial } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

import { inputValidator } from './input.ts';

test('deleteMaterial removes matching artifacts and becomes idempotently false', async (t) => {
  const f = await createServerTest(t);
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
  await assert.rejects(f.caller.material.deleteMaterial({ project: 0n, kind: 'flashcards' }), {
    kind: 'invalid_input'
  });
});

test('deleteMaterial input validator rejects an invalid material kind', async () => {
  const result = await inputValidator['~standard'].validate({ project: 1n, kind: 0 });

  assert.ok(result.issues && result.issues.length > 0);
});

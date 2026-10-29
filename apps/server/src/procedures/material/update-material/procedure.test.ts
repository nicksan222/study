import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createNote as opCreateNote } from '#server/procedures/sources/operations/create-note';
import { createServerTest } from '#testing/server-test';

import { inputValidator } from './input.ts';

test('updateMaterial rejects projects without content and invalid material kinds', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');

  await assert.rejects(
    f.caller.material.updateMaterial({
      project: BigInt(project.id),
      kind: 'flashcards'
    }),
    {
      kind: 'not_enough'
    }
  );
  opCreateNote(f.store, 'Lecture', 'Gravity attracts masses', project.id);
  await assert.rejects(
    f.caller.material.updateMaterial({
      project: 0n,
      kind: 'flashcards'
    }),
    {
      kind: 'invalid_input'
    }
  );
  const accepted = await f.caller.material.updateMaterial({
    project: BigInt(project.id),
    kind: 'flashcards'
  });

  assert.ok(accepted.id > 0n);
});

test('updateMaterial input validator rejects an invalid material kind', async () => {
  const result = await inputValidator['~standard'].validate({ project: 1n, kind: 0 });

  assert.ok(result.issues && result.issues.length > 0);
});

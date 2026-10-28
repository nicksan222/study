import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/operations/create-note';
import { createBackendTest } from '#testing/backend-test';

import { inputValidator } from './input.ts';

test('canUpdateMaterial reflects project content and rejects an unspecified kind', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const result = await f.caller.material.canUpdateMaterial({
    project: BigInt(project.id),
    kind: 'flashcards'
  });

  assert.equal(result.value, false);
  opCreateNote(f.store, 'Lecture', 'Gravity attracts masses', project.id);
  assert.equal(
    (
      await f.caller.material.canUpdateMaterial({
        project: BigInt(project.id),
        kind: 'flashcards'
      })
    ).value,
    true
  );
  await assert.rejects(f.caller.material.canUpdateMaterial({ project: 0n, kind: 'flashcards' }), {
    kind: 'invalid_input'
  });
});

test('canUpdateMaterial input validator rejects an invalid material kind', async () => {
  const result = await inputValidator['~standard'].validate({ project: 1n, kind: 0 });

  assert.ok(result.issues && result.issues.length > 0);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/create-note';
import { fixture } from '#testing/procedures';
test('updateMaterial rejects projects without content and invalid material kinds', async (t) => {
  const f = await fixture(t);
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
      project: BigInt(project.id),
      kind: 0
    } as never),
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

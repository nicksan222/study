import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/create-note';
import { fixture } from '#testing/procedures';
test('canUpdateMaterial reflects project content and rejects an unspecified kind', async (t) => {
  const f = await fixture(t);
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
  await assert.rejects(
    f.caller.material.canUpdateMaterial({
      project: BigInt(project.id),
      kind: 0
    } as never),
    {
      kind: 'invalid_input'
    }
  );
});

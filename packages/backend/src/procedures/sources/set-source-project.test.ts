import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as dbCreateProject } from '#backend/procedures/projects/create-project';
import { fixture } from '#testing/procedures';

import { createNote as dbCreateNote } from './create-note.ts';
import { source as dbSource } from './source.ts';
test('setSourceProject assigns unowned sources and seals published ownership', async (t) => {
  const f = await fixture(t);
  const project = dbCreateProject(f.store, 'Course');
  const source = dbCreateNote(f.store, 'n', 'body');

  assert.equal(
    (
      await f.caller.sources.setSourceProject({
        id: source.id,
        project: project.id
      })
    ).value,
    true
  );
  assert.equal(dbSource(f.store, source.id)?.projectId, project.id);
  await assert.rejects(f.caller.sources.setSourceProject({ id: source.id }), {
    kind: 'invalid_input'
  });
  assert.equal(dbSource(f.store, source.id)?.projectId, project.id);
});

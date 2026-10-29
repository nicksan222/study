import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as dbCreateProject } from '#server/procedures/projects/operations/create-project';
import { project as dbProject } from '#server/procedures/projects/operations/read-projects';
import { createServerTest } from '#testing/server-test';
test('renameProject updates one project and reports missing rows without writing', async (t) => {
  const f = await createServerTest(t);
  const p = dbCreateProject(f.store, 'Before');

  assert.equal(
    (
      await f.caller.projects.renameProject({
        id: p.id,
        name: 'After'
      })
    ).value,
    true
  );
  assert.equal(dbProject(f.store, p.id)?.name, 'After');
  assert.equal(
    (
      await f.caller.projects.renameProject({
        id: 999n,
        name: 'Missing'
      })
    ).value,
    false
  );
  await assert.rejects(
    f.caller.projects.renameProject({
      id: 0n,
      name: 'Bad'
    }),
    {
      kind: 'invalid_input'
    }
  );
  await assert.rejects(
    f.caller.projects.renameProject({
      id: p.id,
      name: ''
    }),
    {
      kind: 'invalid_input'
    }
  );
});

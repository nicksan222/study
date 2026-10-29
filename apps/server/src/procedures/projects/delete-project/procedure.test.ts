import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as dbCreateProject } from '#server/procedures/projects/operations/create-project';
import { project as dbProject } from '#server/procedures/projects/operations/read-projects';
import { createServerTest } from '#testing/server-test';
test('deleteProject deletes persisted projects once and rejects invalid IDs', async (t) => {
  const f = await createServerTest(t);
  const p = dbCreateProject(f.store, 'Delete');

  assert.equal(
    (
      await f.caller.projects.deleteProject({
        id: p.id
      })
    ).value,
    true
  );
  assert.equal(dbProject(f.store, p.id), null);
  assert.equal(
    (
      await f.caller.projects.deleteProject({
        id: p.id
      })
    ).value,
    false
  );
  await assert.rejects(
    f.caller.projects.deleteProject({
      id: 0n
    }),
    {
      kind: 'invalid_input'
    }
  );
});

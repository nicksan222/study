import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { createProject as dbCreateProject } from './create-project.ts';
import { project as dbProject } from './projects.ts';
test('renameProject updates one project and reports missing rows without writing', async (t) => {
  const f = await fixture(t);
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
      name: 'Bad'
    } as never),
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

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProjectId } from '#backend/shared/ids';
import { fixture } from '#testing/procedures';

import { listProjects as dbListProjects, project as dbProject } from './projects.ts';
test('createProject persists normalized names and rejects blank input', async (t) => {
  const f = await fixture(t);
  const result = await f.caller.projects.createProject({
    name: ' Physics '
  });

  assert.equal(result.name, 'Physics');
  assert.equal(dbProject(f.store, result.id as ProjectId)?.name, 'Physics');
  await assert.rejects(
    f.caller.projects.createProject({
      name: '  '
    }),
    {
      kind: 'invalid_input'
    }
  );
  assert.equal(dbListProjects(f.store).length, 1);
});

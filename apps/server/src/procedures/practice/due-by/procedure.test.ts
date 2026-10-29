import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { savePreferences as opSavePreferences } from '#server/procedures/settings/preferences';
import { completeMaterial } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

test('dueBy counts due cards through the requested time and project', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const other = opCreateProject(f.store, 'Other');

  completeMaterial(f.store, project.id);
  completeMaterial(f.store, other.id);
  const result = await f.caller.practice.dueBy({
    project: BigInt(project.id),
    until: 9999999999n
  });

  assert.equal(result.value, 1);
  assert.equal(
    (await f.caller.practice.dueBy({ project: BigInt(project.id), until: 0n })).value,
    0
  );
  assert.equal((await f.caller.practice.dueBy({ until: 9999999999n })).value, 2);
  opSavePreferences(f.store, 'review', { newCardsPerDay: 0 });
  assert.equal(
    (await f.caller.practice.dueBy({ project: BigInt(project.id), until: 9999999999n })).value,
    0
  );
});

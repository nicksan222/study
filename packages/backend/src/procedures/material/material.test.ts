import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture, completeMaterial } from '#testing/procedures';

import { requestMaterial as opRequestMaterial } from './update-material.ts';
test('material groups completed artifacts as current and returns empty for another project', async (t) => {
  const f = await fixture(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeMaterial(f.store, project.id);
  const pending = opRequestMaterial(f.store, project.id, 'flashcards', 'Cards', []);
  const result = await f.caller.material.material({
    id: BigInt(project.id)
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.current?.id, BigInt(made.artifactId));
  assert.equal(result.items[0]?.update?.id, BigInt(pending.artifactId));
  assert.deepEqual(
    (
      await f.caller.material.material({
        id: 999999n
      })
    ).items,
    []
  );
});

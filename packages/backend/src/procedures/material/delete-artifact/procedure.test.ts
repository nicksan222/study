import assert from 'node:assert/strict';
import { test } from 'node:test';

import { artifact as opArtifact } from '#backend/procedures/material/operations/artifact';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createBackendTest } from '#testing/backend-test';
import { completeMaterial } from '#testing/procedures';
test('deleteArtifact removes an existing artifact and is false when repeated', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeMaterial(f.store, project.id);
  const result = await f.caller.material.deleteArtifact({
    id: BigInt(made.artifactId)
  });

  assert.equal(result.value, true);
  assert.equal(opArtifact(f.store, made.artifactId), null);
  assert.equal(
    (
      await f.caller.material.deleteArtifact({
        id: BigInt(made.artifactId)
      })
    ).value,
    false
  );
});

test('canonical rename, archive and projection deletion keep study lists consistent and preserve snapshots', async (t) => {
  const f = await createBackendTest(t);
  const project = opCreateProject(f.store, 'P');
  const made = completeMaterial(f.store, project.id);
  const artifact = opArtifact(f.store, made.artifactId)!;

  assert.ok(artifact.materialId);
  const detail = await f.caller.materials.get({ id: artifact.materialId });

  await f.caller.materials.rename({ id: artifact.materialId, title: 'Renamed' });
  assert.equal(opArtifact(f.store, made.artifactId)?.title, 'Renamed');
  await f.caller.materials.archive({ id: artifact.materialId });
  assert.equal((await f.caller.material.material({ id: project.id })).items.length, 0);
  assert.equal((await f.caller.practice.dueCards({ project: project.id })).items.length, 0);
  assert.equal((await f.caller.practice.dueCount({ project: project.id })).value, 0);
  await f.caller.materials.unarchive({ id: artifact.materialId });
  assert.equal((await f.caller.practice.dueCards({ project: project.id })).items.length, 1);
  await f.caller.material.deleteArtifact({ id: artifact.id });
  assert.ok((await f.caller.materials.get({ id: artifact.materialId }))?.archived_at);
  assert.equal(
    (await f.caller.materials.getVersion({ id: detail!.version.id }))?.status,
    'published'
  );
});

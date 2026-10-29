import assert from 'node:assert/strict';
import { test } from 'node:test';

import { claimJob } from '#server/procedures/jobs/worker';
import { finishMaterial } from '#server/procedures/material/finish-material';
import { artifact } from '#server/procedures/material/operations/artifact';
import { cards as opCards } from '#server/procedures/material/operations/artifact';
import { updateDiagram, renameArtifact } from '#server/procedures/material/operations/set-card';
import { requestMaterial } from '#server/procedures/material/operations/update-material';
import { readMaterial, readVersion } from '#server/procedures/materials/reads';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { completeMaterial } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';
test('setCard writes and deletes cards and handles missing indices and changes', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeMaterial(f.store, project.id);
  const result = await f.caller.material.setCard({
    artifact: BigInt(made.artifactId),
    index: 0,
    change: {
      type: 'write',
      front: 'Q',
      back: 'A'
    }
  });

  assert.equal(result.value, true);
  assert.equal(opCards(f.store, made.artifactId)[0]?.front, 'Q');
  assert.equal(
    (
      await f.caller.material.setCard({
        artifact: BigInt(made.artifactId),
        index: 100,
        change: {
          type: 'delete'
        }
      })
    ).value,
    false
  );
  assert.equal(
    (
      await f.caller.material.setCard({
        artifact: BigInt(made.artifactId),
        index: 0,
        change: {
          type: 'delete'
        }
      })
    ).value,
    true
  );
});

test('card edits append canonical snapshots and deleting the last card archives the deck', async (t) => {
  const f = await createServerTest(t),
    p = opCreateProject(f.store, 'Physics'),
    made = completeMaterial(f.store, p.id);
  const projection = artifact(f.store, made.artifactId)!;

  assert.ok(projection.materialId);
  const initial = readMaterial(f.store, projection.materialId)!.version;

  await f.caller.material.setCard({
    artifact: made.artifactId,
    index: 0,
    change: { type: 'write', front: 'Edited?', back: 'Edited!' }
  });
  const edited = readMaterial(f.store, projection.materialId)!.version;

  assert.equal(edited.number, 2n);
  assert.equal(edited.operation, 'edit');
  assert.equal(edited.creator, 'user');
  assert.deepEqual(edited.parents, [initial.id]);
  assert.equal(edited.kind, 'flashcards');

  if (edited.kind === 'flashcards' && initial.kind === 'flashcards') {
    assert.equal(edited.content.cards[0]?.front, 'Edited?');
    assert.equal(edited.content.cards[0]?.cardId, initial.content.cards[0]?.cardId);
  }

  await f.caller.material.setCard({
    artifact: made.artifactId,
    index: 0,
    change: { type: 'delete' }
  });
  assert.ok(readMaterial(f.store, projection.materialId)?.archived_at);
  assert.equal(readVersion(f.store, initial.id)?.kind, 'flashcards');
});

test('diagram edits append revisions and artifact rename syncs canonical metadata', async (t) => {
  const f = await createServerTest(t),
    p = opCreateProject(f.store, 'Physics');
  const request = requestMaterial(f.store, p.id, 'diagram', 'Map', []),
    job = claimJob(f.store, ['artifact'])!;

  finishMaterial(
    f.store,
    request.artifactId,
    job.id,
    job.attempts,
    { type: 'diagram', mermaid: 'graph TD; A-->B' },
    []
  );
  const projection = artifact(f.store, request.artifactId)!;

  assert.ok(projection.materialId);
  const first = readMaterial(f.store, projection.materialId)!.version;

  assert.equal(updateDiagram(f.store, request.artifactId, 'graph TD; A-->C'), true);
  const next = readMaterial(f.store, projection.materialId)!.version;

  assert.equal(next.number, 2n);
  assert.deepEqual(next.parents, [first.id]);
  assert.equal(next.creator, 'user');

  if (next.kind === 'diagram') assert.equal(next.content.payload, 'graph TD; A-->C');

  if (first.kind === 'diagram')
    assert.equal(readVersion(f.store, first.id)?.content.kind, 'diagram');

  assert.equal(renameArtifact(f.store, request.artifactId, 'New title'), true);
  assert.equal(readMaterial(f.store, projection.materialId)?.title, 'New title');
  assert.equal(readMaterial(f.store, projection.materialId)?.version.id, next.id);
});

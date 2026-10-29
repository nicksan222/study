import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { claimJob } from '#server/procedures/jobs/worker';
import { learningRouter } from '#server/procedures/learning/router';
import { readCitations } from '#server/procedures/materials/operations/citations';
import { readMaterial, readVersion } from '#server/procedures/materials/reads';
import { createProject } from '#server/procedures/projects/operations/create-project';
import { createNote } from '#server/procedures/sources/operations/create-note';
import { saveDocument } from '#server/procedures/sources/operations/source-document';
import { document } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

import { finishMaterial } from './finish-material.ts';
import { artifact, cards } from './operations/artifact.ts';
import { requestMaterial } from './operations/update-material.ts';

test('generated flashcards publish canonical revisions while matching cards retain identity', async (t) => {
  const f = await createServerTest(t),
    p = createProject(f.store, 'Physics');
  const first = requestMaterial(f.store, p.id, 'flashcards', 'Cards', []),
    job = claimJob(f.store, ['artifact'])!;

  assert.equal(
    finishMaterial(
      f.store,
      first.artifactId,
      job.id,
      job.attempts,
      { type: 'flashcards', cards: [{ front: 'Gravity?', back: 'Attraction', cites: [] }] },
      []
    ),
    true
  );
  const projection = artifact(f.store, first.artifactId)!;

  assert.ok(projection.materialId);
  const head = readMaterial(f.store, projection.materialId)!;

  assert.equal(head.version.creator, 'agent');
  assert.equal(head.version.kind, 'flashcards');
  const oldCard = cards(f.store, first.artifactId)[0]!;

  assert.ok(oldCard.materialCardId);
  const learning = learningRouter.createCaller(f.context);

  await learning.reviewCard({
    versionId: head.version.id,
    cardId: oldCard.materialCardId,
    rating: 'good'
  });
  const next = requestMaterial(f.store, p.id, 'flashcards', 'Cards', []),
    nextJob = claimJob(f.store, ['artifact'])!;

  assert.equal(artifact(f.store, next.artifactId)?.materialId, projection.materialId);
  assert.equal(
    finishMaterial(
      f.store,
      next.artifactId,
      nextJob.id,
      nextJob.attempts,
      {
        type: 'flashcards',
        cards: [
          { front: 'Gravity?', back: 'Attraction', cites: [] },
          { front: 'Mass?', back: 'Matter', cites: [] }
        ]
      },
      []
    ),
    true
  );
  const updated = readMaterial(f.store, projection.materialId)!;

  assert.equal(updated.version.number, 2n);
  assert.deepEqual(updated.version.parents, [head.version.id]);
  assert.equal(cards(f.store, next.artifactId)[0]?.materialCardId, oldCard.materialCardId);
  assert.equal(artifact(f.store, first.artifactId), null);
  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_card_reviews)
      .where(eq(s.material_card_reviews.card_id, oldCard.materialCardId))
      .get()?.version_id,
    head.version.id
  );
  assert.equal(readVersion(f.store, head.version.id)?.kind, 'flashcards');
  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_card_identities)
      .where(eq(s.material_card_identities.id, oldCard.materialCardId))
      .get()?.material_id,
    projection.materialId
  );
});

test('generation retains multiple exact document snapshots when newer extraction arrives', async (t) => {
  const f = await createServerTest(t),
    p = createProject(f.store, 'Physics');
  const a = createNote(f.store, 'A', 'Old gravity', p.id),
    b = createNote(f.store, 'B', 'Mass', p.id);
  const docA = saveDocument(f.store, a.id, {
    ...document,
    blocks: [{ kind: 'paragraph', text: 'Old gravity', anchor: { type: 'paragraph', index: 0 } }]
  });
  const docB = saveDocument(f.store, b.id, {
    ...document,
    blocks: [{ kind: 'paragraph', text: 'Mass', anchor: { type: 'paragraph', index: 0 } }]
  });
  const inputA = f.store.db.orm
    .select()
    .from(s.material_document_versions)
    .where(eq(s.material_document_versions.document_id, docA))
    .get()!.version_id;
  const inputB = f.store.db.orm
    .select()
    .from(s.material_document_versions)
    .where(eq(s.material_document_versions.document_id, docB))
    .get()!.version_id;
  const request = requestMaterial(f.store, p.id, 'diagram', 'Map', [a.id, b.id]),
    job = claimJob(f.store, ['artifact'])!;

  saveDocument(f.store, a.id, {
    ...document,
    blocks: [{ kind: 'paragraph', text: 'New gravity', anchor: { type: 'paragraph', index: 0 } }]
  });
  assert.equal(
    finishMaterial(
      f.store,
      request.artifactId,
      job.id,
      job.attempts,
      { type: 'diagram', mermaid: 'graph TD; A-->B' },
      [
        {
          marker: 1,
          sourceId: a.id,
          sourceName: 'A',
          quote: 'Old gravity',
          anchor: { type: 'paragraph', index: 0 }
        },
        {
          marker: 2,
          sourceId: b.id,
          sourceName: 'B',
          quote: 'Mass',
          anchor: { type: 'paragraph', index: 0 }
        }
      ]
    ),
    true
  );
  const projection = artifact(f.store, request.artifactId)!;

  assert.ok(projection.materialId);
  const version = readMaterial(f.store, projection.materialId)!.version;

  assert.deepEqual(version.inputs, [inputA, inputB]);
  assert.deepEqual(
    readCitations(f.store, version.id).map((c) => c.inputVersionId),
    [inputA, inputB]
  );
  assert.equal(
    finishMaterial(
      f.store,
      request.artifactId,
      job.id,
      job.attempts,
      { type: 'diagram', mermaid: 'duplicate' },
      []
    ),
    false
  );
  assert.equal(readMaterial(f.store, projection.materialId)?.version.number, 1n);
});

test('regeneration removing a legacy card preserves its canonical review and snapshot', async (t) => {
  const f = await createServerTest(t),
    p = createProject(f.store, 'Physics'),
    first = requestMaterial(f.store, p.id, 'flashcards', 'Cards', []),
    job = claimJob(f.store, ['artifact'])!;

  finishMaterial(
    f.store,
    first.artifactId,
    job.id,
    job.attempts,
    { type: 'flashcards', cards: [{ front: 'Old', back: 'Answer', cites: [] }] },
    []
  );
  const projection = artifact(f.store, first.artifactId)!;

  assert.ok(projection.materialId);
  const version = readMaterial(f.store, projection.materialId)!.version,
    card = cards(f.store, first.artifactId)[0]!;

  assert.ok(card.materialCardId);
  const learning = learningRouter.createCaller(f.context);

  await learning.reviewCard({ versionId: version.id, cardId: card.materialCardId, rating: 'good' });
  const next = requestMaterial(f.store, p.id, 'flashcards', 'Cards', []),
    nextJob = claimJob(f.store, ['artifact'])!;

  finishMaterial(
    f.store,
    next.artifactId,
    nextJob.id,
    nextJob.attempts,
    { type: 'flashcards', cards: [{ front: 'Replacement', back: 'New answer', cites: [] }] },
    []
  );
  assert.equal(cards(f.store, first.artifactId).length, 0);
  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_card_reviews)
      .where(eq(s.material_card_reviews.card_id, card.materialCardId))
      .get()?.version_id,
    version.id
  );
  const old = readVersion(f.store, version.id);

  if (old?.kind === 'flashcards') assert.equal(old.content.cards[0]?.front, 'Old');

  assert.notEqual(cards(f.store, next.artifactId)[0]?.materialCardId, card.materialCardId);
});

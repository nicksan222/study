import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/operations/create-session';
import { editMessage as opEditMessage } from '#backend/procedures/conversations/operations/edit-message';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/operations/post-message';
import { job as opJob } from '#backend/procedures/jobs/operations/job';
import {
  claimJob as opClaimJob,
  finishJob as opFinishJob,
  recoverJobs as opRecoverJobs,
  enqueueJob as opEnqueueJob
} from '#backend/procedures/jobs/worker';
import { finishMaterial as opFinishMaterial } from '#backend/procedures/material/finish-material';
import {
  cards as opCards,
  artifact as opArtifact
} from '#backend/procedures/material/operations/artifact';
import { materialChanges as opMaterialChanges } from '#backend/procedures/material/operations/material-changes';
import {
  updateCard as opUpdateCard,
  deleteCard as opDeleteCard
} from '#backend/procedures/material/operations/set-card';
import { requestMaterial as opRequestMaterial } from '#backend/procedures/material/operations/update-material';
import { dueCards as opDueCards } from '#backend/procedures/practice/operations/due-cards';
import {
  countDueCards as opCountDueCards,
  newCardsSince as opNewCardsSince
} from '#backend/procedures/practice/operations/due-count';
import { reviewCard as opReviewCard } from '#backend/procedures/practice/operations/review';
import { reviewTimes as opReviewTimes } from '#backend/procedures/practice/operations/review-times';
import { createProject as opCreateProject } from '#backend/procedures/projects/operations/create-project';
import { createNote as opCreateNote } from '#backend/procedures/sources/operations/create-note';
import { deleteSource as opDeleteSource } from '#backend/procedures/sources/operations/delete-source';
import { BackendContext } from '#backend/runtime/context';
import { createBackendTest } from '#testing/backend-test';

test('materials finish on their current attempt and cards keep review scheduling', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      src = opCreateNote(store, 'n', 'text'),
      created = opRequestMaterial(store, p.id, 'flashcards', 'Cards', [src.id]);
    const claimed = opClaimJob(store, ['artifact'])!;

    assert.equal(opFinishJob(store, claimed.id, claimed.attempts), false);
    assert.equal(
      opFinishMaterial(
        store,
        created.artifactId,
        created.jobId,
        claimed.attempts,
        { type: 'flashcards', cards: [{ front: 'Q', back: 'A', cites: [] }] },
        []
      ),
      true
    );
    const card = opCards(store, created.artifactId)[0];

    assert.equal(opDueCards(store, p.id, card.memory.due).length, 1);
    const reviewed = opReviewCard(store, card.id, 'good', 1800000000n)!;

    assert.equal(reviewed.memory.reps, 1);
    assert.ok(reviewed.memory.due > 1800000000n);
    assert.equal(opCards(store, created.artifactId)[0].memory.due, reviewed.memory.due);
    assert.equal(opUpdateCard(store, card.id, 'new Q', 'new A'), true);
    assert.equal(opCards(store, created.artifactId)[0].front, 'new Q');
    assert.equal(opDeleteCard(store, card.id), true);
    assert.equal(opCards(store, created.artifactId).length, 0);
  } finally {
    store.close();
  }
});
test('editing cards invalidates in-flight material updates', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      first = opRequestMaterial(store, p.id, 'flashcards', 'Cards', []);

    opClaimJob(store, ['artifact']);
    opFinishMaterial(
      store,
      first.artifactId,
      first.jobId,
      1n,
      { type: 'flashcards', cards: [{ front: 'q', back: 'a', cites: [] }] },
      []
    );
    const next = opRequestMaterial(store, p.id, 'flashcards', 'Cards', []);

    opClaimJob(store, ['artifact']);
    opUpdateCard(store, opCards(store, first.artifactId)[0].id, 'edit', 'a');
    assert.equal(
      opFinishMaterial(
        store,
        next.artifactId,
        next.jobId,
        1n,
        { type: 'flashcards', cards: [] },
        []
      ),
      false
    );
    assert.equal(opCards(store, first.artifactId)[0].front, 'edit');
  } finally {
    store.close();
  }
});
test('card changes update material body and retained cards keep review history', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      a = opRequestMaterial(store, p.id, 'flashcards', 'Cards', []);

    opClaimJob(store, ['artifact']);
    opFinishMaterial(
      store,
      a.artifactId,
      a.jobId,
      1n,
      { type: 'flashcards', cards: [{ front: 'q', back: 'a', cites: [1] }] },
      []
    );
    const card = opCards(store, a.artifactId)[0];

    opReviewCard(store, card.id, 'good', 1800000000n);
    const b = opRequestMaterial(store, p.id, 'flashcards', 'Cards', []);

    opClaimJob(store, ['artifact']);
    opFinishMaterial(
      store,
      b.artifactId,
      b.jobId,
      1n,
      { type: 'flashcards', cards: [{ front: 'q', back: 'a', cites: [2] }] },
      []
    );
    const retained = opCards(store, b.artifactId)[0];

    assert.equal(retained.id, card.id);
    assert.equal(retained.memory.reps, 1);
    assert.deepEqual(retained.cites, [2]);
    opUpdateCard(store, card.id, 'edited', 'answer');
    const body = opArtifact(store, b.artifactId)?.body;

    assert.equal(body?.type, 'flashcards');

    if (body?.type === 'flashcards') assert.equal(body.cards[0].front, 'edited');

    opDeleteCard(store, card.id);
    const empty = opArtifact(store, b.artifactId)?.body;

    if (empty?.type === 'flashcards') assert.equal(empty.cards.length, 0);
  } finally {
    store.close();
  }
});
test('all review grades persist and due filtering uses the scheduled time', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      a = opRequestMaterial(store, p.id, 'flashcards', 'Cards', []);

    opClaimJob(store, ['artifact']);
    opFinishMaterial(
      store,
      a.artifactId,
      a.jobId,
      1n,
      {
        type: 'flashcards',
        cards: ['again', 'hard', 'good', 'easy'].map((front) => ({
          front,
          back: 'answer',
          cites: []
        }))
      },
      []
    );
    const t = 1800000000n;
    const cards = opCards(store, a.artifactId);

    for (const [index, rating] of (['again', 'hard', 'good', 'easy'] as const).entries()) {
      const reviewed = opReviewCard(store, cards[index].id, rating, t)!;

      assert.equal(reviewed.memory.reps, 1);
      assert.equal(reviewed.memory.lastReview, t);
      assert.ok(reviewed.memory.due > t);
      assert.deepEqual(opCards(store, a.artifactId)[index].memory, reviewed.memory);
    }

    assert.equal(opDueCards(store, p.id, t).length, 0);
    assert.equal(opDueCards(store, p.id, t + 365n * 86400n).length, 4);
  } finally {
    store.close();
  }
});
test('stale artifact attempt and invalid citations cannot overwrite or finish work', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      a = opRequestMaterial(store, p.id, 'diagram', 'Diagram', []);

    opClaimJob(store, ['artifact']);
    opRecoverJobs(store);
    opClaimJob(store, ['artifact']);
    const body = { type: 'diagram' as const, mermaid: 'flowchart TD\nA-->B' };

    assert.equal(opFinishMaterial(store, a.artifactId, a.jobId, 1n, body, []), false);
    assert.throws(() =>
      opFinishMaterial(store, a.artifactId, a.jobId, 2n, body, [
        {
          marker: 0,
          sourceId: null,
          sourceName: 's',
          anchor: { type: 'page', page: 1 },
          quote: 'x'
        }
      ])
    );
    assert.equal(opJob(store, a.jobId)?.status, 'running');
    assert.equal(opArtifact(store, a.artifactId)?.body, null);
    assert.equal(opFinishMaterial(store, a.artifactId, a.jobId, 2n, body, []), true);
  } finally {
    store.close();
  }
});
test('material change counts track source and note additions and edits', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      s = opCreateSession(store, p.id, 'S'),
      source = opCreateNote(store, 'one', 'text', p.id),
      message = opPostMessage(store, { sessionId: s.id, text: 'original' }),
      a = opRequestMaterial(store, p.id, 'diagram', 'Diagram', [source.id]);

    opClaimJob(store, ['artifact']);
    opFinishMaterial(
      store,
      a.artifactId,
      a.jobId,
      1n,
      { type: 'diagram', mermaid: 'flowchart TD\nA-->B' },
      []
    );
    assert.deepEqual(opMaterialChanges(store, a.artifactId), {
      files: 0,
      notes: 0
    });
    opCreateNote(store, 'two', 'text', p.id);
    opEditMessage(store, message.id, 'edited');
    assert.deepEqual(opMaterialChanges(store, a.artifactId), {
      files: 1,
      notes: 2
    });
    assert.throws(() => opDeleteSource(store, source.id));
    assert.deepEqual(opMaterialChanges(store, a.artifactId), {
      files: 1,
      notes: 2
    });
  } finally {
    store.close();
  }
});
test('material waits for source reads and citations retain anchors and source identity', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
    store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      source = opCreateNote(store, 'n', 'text', p.id);
    const read = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: source.id }
    });
    const a = opRequestMaterial(store, p.id, 'diagram', 'D', [source.id]);

    assert.equal(opJob(store, a.jobId)?.status, 'blocked');
    opClaimJob(store, ['extract']);
    opFinishJob(store, read, 1n);
    assert.equal(opJob(store, a.jobId)?.status, 'queued');
    opClaimJob(store, ['artifact']);
    opFinishMaterial(
      store,
      a.artifactId,
      a.jobId,
      1n,
      { type: 'diagram', mermaid: 'flowchart TD\nA-->B' },
      [
        {
          marker: 1,
          sourceId: source.id,
          sourceName: 'n',
          anchor: { type: 'page', page: 2 },
          quote: 'text'
        }
      ]
    );
    assert.throws(() => opDeleteSource(store, source.id));
    assert.deepEqual(opArtifact(store, a.artifactId)?.citations, [
      {
        marker: 1,
        sourceId: source.id,
        sourceName: 'n',
        anchor: { type: 'page', page: 2 },
        quote: 'text'
      }
    ]);
  } finally {
    store.close();
  }
});

test('new-card allowance is global while reviewed cards remain due', (t) => {
  const testDatabase = createBackendTest(t, { app: false });
  const store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  try {
    const projects = [opCreateProject(store, 'A'), opCreateProject(store, 'B')];
    const cards = projects.map((p) => {
      const request = opRequestMaterial(store, p.id, 'flashcards', 'Cards', []);

      opClaimJob(store, ['artifact']);
      opFinishMaterial(
        store,
        request.artifactId,
        request.jobId,
        1n,
        { type: 'flashcards', cards: [{ front: 'Q', back: 'A', cites: [] }] },
        []
      );

      return opCards(store, request.artifactId)[0];
    });
    const at = 2000000000n;

    assert.equal(opDueCards(store, projects[0].id, at, 100, 1).length, 1);
    assert.equal(opDueCards(store, projects[1].id, at, 100, 1).length, 0);
    assert.equal(opCountDueCards(store, null, at, 1), 1);
    opReviewCard(store, cards[1].id, 'again', at);
    assert.equal(opDueCards(store, projects[1].id, at + 600n, 100, 0).length, 1);
    assert.equal(opNewCardsSince(store, at), 1);
    assert.deepEqual(opReviewTimes(store, projects[1].id, at), [at]);
  } finally {
    store.close();
  }
});

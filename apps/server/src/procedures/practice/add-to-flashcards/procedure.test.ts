import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { cards as opCards } from '#server/procedures/material/operations/artifact';
import { listArtifacts as opListArtifacts } from '#server/procedures/material/operations/material';
import { updateCard } from '#server/procedures/material/operations/set-card';
import { answerQuestion as opAnswerQuestion } from '#server/procedures/practice/operations/answer-question';
import { reviewCard } from '#server/procedures/practice/operations/review';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { completeQuestion } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';
test('addToFlashcards saves an incorrect answer and rejects a non-mistake or missing question', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const q = completeQuestion(f.store, project.id);

  opAnswerQuestion(f.store, q.questionId, {
    type: 'choice',
    choice: 1
  });
  const result = await f.caller.practice.addToFlashcards({
    question: BigInt(q.questionId),
    title: 'Mistakes'
  });

  assert.equal(result.value, true);
  const mistakeArtifact = opListArtifacts(f.store, project.id).find(
    (artifact) => artifact.mistakes
  );

  assert.ok(mistakeArtifact);
  assert.equal(mistakeArtifact.title, 'Mistakes');
  assert.equal(opCards(f.store, mistakeArtifact.id)[0]?.front, 'Gravity is?');
  assert.equal(opCards(f.store, mistakeArtifact.id)[0]?.back, 'Attraction');
  const correct = completeQuestion(f.store, project.id);

  await assert.rejects(
    f.caller.practice.addToFlashcards({
      question: BigInt(correct.questionId),
      title: 'Mistakes'
    }),
    {
      kind: 'invalid_input'
    }
  );
  await assert.rejects(
    f.caller.practice.addToFlashcards({
      question: 999999n,
      title: 'Mistakes'
    }),
    {
      kind: 'not_found'
    }
  );
});

test('mistake cards publish before review and preserve canonical scheduling through edits and later additions', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'P');
  const q = completeQuestion(f.store, project.id);

  opAnswerQuestion(f.store, q.questionId, { type: 'choice', choice: 1 });
  await f.caller.practice.addToFlashcards({ question: q.questionId, title: 'Mistakes' });
  const deck = opListArtifacts(f.store, project.id).find((a) => a.mistakes)!;
  const card = opCards(f.store, deck.id)[0]!;

  assert.ok(card.materialCardId);
  assert.equal(reviewCard(f.store, card.id, 'good', 2000000000n)?.memory.reps, 1);
  assert.equal(updateCard(f.store, card.id, 'Edited question', 'Edited answer'), true);
  assert.equal(reviewCard(f.store, card.id, 'easy', 2000086400n)?.memory.reps, 2);
  const second = completeQuestion(f.store, project.id);

  opAnswerQuestion(f.store, second.questionId, { type: 'choice', choice: 1 });
  await f.caller.practice.addToFlashcards({ question: second.questionId, title: 'Mistakes' });
  const current = opCards(f.store, deck.id);

  assert.equal(current.length, 2);
  assert.ok(current[1]!.materialCardId);
  assert.equal(current[0]!.materialCardId, card.materialCardId);
  assert.equal(current[0]!.memory.reps, 2);
  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_card_reviews)
      .where(eq(s.material_card_reviews.card_id, card.materialCardId))
      .all().length,
    2
  );
});

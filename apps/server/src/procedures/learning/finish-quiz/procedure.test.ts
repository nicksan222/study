import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';

import { setup, seedQuiz } from '#server/procedures/learning/test-support';

test('finishQuiz reveals keys and freezes results while preserving earlier revisions and attempts', async (t) => {
  const f = await setup(t),
    q = seedQuiz(f),
    a = await f.learning.startQuiz({ versionId: q.versionId });

  for (let i = 0; i < 2; i++)
    await f.learning.answerQuestion({
      attemptId: a.id,
      questionId: q.questions[i]!.id,
      answer: {
        type: 'choice',
        choiceIds: q.choices[i]!.filter((c) => c.is_correct).map((c) => c.id)
      }
    });

  await f.learning.answerQuestion({
    attemptId: a.id,
    questionId: q.questions[2]!.id,
    answer: { type: 'open', answer: 'Response' }
  });
  await f.learning.gradeResponse({
    attemptId: a.id,
    questionId: q.questions[2]!.id,
    score: 0.5,
    feedback: 'Partial'
  });
  const result = await f.learning.finishQuiz({ attemptId: a.id });

  assert.equal(result.status, 'completed');
  assert.equal(result.scoring.score, 2.5 / 3);
  const single = result.questions[0]!;

  assert.equal(single.kind, 'single_choice');

  assert.deepEqual(
    single.choices.map((c) => c.isCorrect),
    [true, false, false]
  );

  assert.equal(result.questions[2]!.kind, 'open');
  assert.equal(result.questions[2]!.explanation, 'secret explanation');
  assert.equal(
    'referenceAnswer' in result.questions[2]! && result.questions[2]!.referenceAnswer,
    'secret reference'
  );
  await assert.rejects(
    f.learning.answerQuestion({
      attemptId: a.id,
      questionId: q.questions[2]!.id,
      answer: { type: 'open', answer: 'changed' }
    }),
    { kind: 'invalid_input' }
  );
  await assert.rejects(
    f.learning.gradeResponse({ attemptId: a.id, questionId: q.questions[2]!.id, score: 1 }),
    { kind: 'invalid_input' }
  );
  await assert.rejects(f.learning.finishQuiz({ attemptId: a.id }), { kind: 'invalid_input' });
  seedQuiz(f, q.materialId);
  const repeat = await f.learning.startQuiz({ versionId: q.versionId });

  assert.notEqual(repeat.id, a.id);
  assert.deepEqual(await f.learning.getAttempt({ attemptId: a.id }), result);
});

test('finishQuiz preserves null unanswered/ungraded scores and rejects selection placeholders', async (t) => {
  const f = await setup(t),
    q = seedQuiz(f),
    a = await f.learning.startQuiz({ versionId: q.versionId });

  await f.learning.answerQuestion({
    attemptId: a.id,
    questionId: q.questions[2]!.id,
    answer: { type: 'open', answer: 'Ungraded' }
  });
  f.store.db.orm
    .insert(s.material_quiz_responses)
    .values({
      attempt_id: a.id,
      version_id: q.versionId,
      question_id: q.questions[0]!.id,
      question_kind: 'single_choice'
    })
    .run();
  await assert.rejects(f.learning.finishQuiz({ attemptId: a.id }), { kind: 'invalid_input' });
  await f.learning.answerQuestion({
    attemptId: a.id,
    questionId: q.questions[0]!.id,
    answer: { type: 'choice', choiceIds: [q.choices[0]![0]!.id] }
  });
  const result = await f.learning.finishQuiz({ attemptId: a.id });

  assert.deepEqual(result.scoring, {
    complete: false,
    gradedCount: 1,
    questionCount: 3,
    earned: 1,
    score: null
  });
  assert.equal(result.questions[1]!.grading, 'unanswered');
  assert.equal(result.questions[1]!.score, null);
  assert.equal(result.questions[2]!.grading, 'ungraded');
});

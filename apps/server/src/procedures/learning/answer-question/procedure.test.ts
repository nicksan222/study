import assert from 'node:assert/strict';
import { test } from 'node:test';

import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import { setup, seedQuiz, noLeaks } from '#server/procedures/learning/test-support';

test('answerQuestion validates kind, ownership, cardinality and replacement atomically', async (t) => {
  const f = await setup(t),
    q = seedQuiz(f),
    other = seedQuiz(f);
  const a = await f.learning.startQuiz({ versionId: q.versionId });
  const answer = (questionId: bigint, choiceIds: bigint[]) =>
    f.learning.answerQuestion({
      attemptId: a.id,
      questionId,
      answer: { type: 'choice', choiceIds }
    });
  const id = q.questions[0]!.id,
    correct = q.choices[0]![0]!.id;

  for (const [questionId, choiceIds] of [
    [other.questions[0]!.id, [correct]],
    [id, [other.choices[0]![0]!.id]],
    [id, []],
    [id, [correct, correct]],
    [id, [correct, q.choices[0]![1]!.id]]
  ] as [bigint, bigint[]][])
    await assert.rejects(answer(questionId, choiceIds), { kind: 'invalid_input' });

  await assert.rejects(
    f.learning.answerQuestion({
      attemptId: a.id,
      questionId: id,
      answer: { type: 'open', answer: 'text' }
    }),
    { kind: 'invalid_input' }
  );
  noLeaks(await answer(id, [correct]));
  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_quiz_responses)
      .where(
        and(
          eq(s.material_quiz_responses.attempt_id, a.id),
          eq(s.material_quiz_responses.question_id, id)
        )
      )
      .get()!.score,
    1
  );
  await answer(id, [q.choices[0]![1]!.id]);
  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_quiz_responses)
      .where(eq(s.material_quiz_responses.attempt_id, a.id))
      .get()!.score,
    0
  );
  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_quiz_selections)
      .where(eq(s.material_quiz_selections.attempt_id, a.id))
      .all().length,
    1
  );
  await answer(
    q.questions[1]!.id,
    q.choices[1]!.filter((c) => c.is_correct).map((c) => c.id)
  );
  await answer(q.questions[1]!.id, [q.choices[1]![0]!.id]);
  const finished = await f.learning.finishQuiz({ attemptId: a.id });

  assert.equal(finished.questions[1]!.score, 0);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setup, seedQuiz, noLeaks } from '#server/procedures/learning/test-support';

test('gradeResponse explicitly grades only answered open responses and answering resets grading', async (t) => {
  const f = await setup(t),
    q = seedQuiz(f);
  const a = await f.learning.startQuiz({ versionId: q.versionId }),
    questionId = q.questions[2]!.id;

  await assert.rejects(f.learning.gradeResponse({ attemptId: a.id, questionId, score: 0.5 }), {
    kind: 'invalid_input'
  });
  await f.learning.answerQuestion({
    attemptId: a.id,
    questionId,
    answer: { type: 'open', answer: 'My answer' }
  });
  noLeaks(
    await f.learning.gradeResponse({
      attemptId: a.id,
      questionId,
      score: 0.5,
      feedback: 'secret reference'
    })
  );
  await assert.rejects(f.learning.gradeResponse({ attemptId: a.id, questionId, score: 1.1 }), {
    kind: 'invalid_input'
  });
  await f.learning.answerQuestion({
    attemptId: a.id,
    questionId,
    answer: { type: 'open', answer: 'Revised' }
  });
  const result = await f.learning.finishQuiz({ attemptId: a.id });

  assert.equal(result.questions[2]!.score, null);
  assert.equal(result.questions[2]!.feedback, null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setup, seedQuiz, noLeaks } from './test-support.ts';

test('getAttempt stays on its snapshot and redacts unfinished results', async (t) => {
  const f = await setup(t),
    q = seedQuiz(f);
  const a = await f.learning.startQuiz({ versionId: q.versionId });

  await f.learning.answerQuestion({
    attemptId: a.id,
    questionId: q.questions[0]!.id,
    answer: { type: 'choice', choiceIds: [q.choices[0]![0]!.id] }
  });
  seedQuiz(f, q.materialId);
  const view = await f.learning.getAttempt({ attemptId: a.id });

  assert.equal(view.versionId, q.versionId);
  noLeaks(view);
  await assert.rejects(f.learning.getAttempt({ attemptId: 999999n }), { kind: 'not_found' });
});

test('getAttempt batches a large mixed quiz without changing redaction or completed results', async (t) => {
  const f = await setup(t),
    quiz = seedQuiz(f, undefined, true, 60);
  const attempt = await f.learning.startQuiz({ versionId: quiz.versionId });
  const optionsByQuestion = new Map(
    quiz.choices.map((options) => [options[0]!.question_id, options])
  );

  for (let i = 0; i < quiz.questions.length; i++) {
    const question = quiz.questions[i]!;

    if (i % 7 === 0) continue;

    if (question.kind === 'open') {
      await f.learning.answerQuestion({
        attemptId: attempt.id,
        questionId: question.id,
        answer: { type: 'open', answer: 'Response ' + i }
      });

      if (i % 2 === 0)
        await f.learning.gradeResponse({
          attemptId: attempt.id,
          questionId: question.id,
          score: 0.5,
          feedback: 'Feedback ' + i
        });
    } else {
      await f.learning.answerQuestion({
        attemptId: attempt.id,
        questionId: question.id,
        answer: {
          type: 'choice',
          choiceIds: optionsByQuestion
            .get(question.id)!
            .filter((c) => c.is_correct)
            .map((c) => c.id)
        }
      });
    }
  }

  const before = await f.learning.getAttempt({ attemptId: attempt.id });

  noLeaks(before);
  assert.equal(before.questions.length, 60);
  const completed = await f.learning.finishQuiz({ attemptId: attempt.id });

  assert.deepEqual(await f.learning.getAttempt({ attemptId: attempt.id }), completed);
  assert.equal(completed.scoring.complete, false);

  for (let i = 0; i < completed.questions.length; i++) {
    const result = completed.questions[i]!,
      original = quiz.questions[i]!,
      redacted = before.questions[i]!;

    assert.equal(result.id, original.id);
    assert.equal(result.kind, original.kind);
    assert.equal(result.position, BigInt(i));
    assert.equal(result.explanation, original.explanation);
    assert.deepEqual(result.answer, redacted.answer);

    if (result.kind === 'open') {
      assert.equal(result.referenceAnswer, 'secret reference');
      assert.equal(result.score, i % 7 !== 0 && i % 2 === 0 ? 0.5 : null);
      assert.equal(result.feedback, i % 7 !== 0 && i % 2 === 0 ? 'Feedback ' + i : null);
      assert.deepEqual(Object.keys(redacted).sort(), [
        'answer',
        'id',
        'kind',
        'position',
        'prompt'
      ]);
    } else {
      const expected = optionsByQuestion.get(original.id)!;

      assert.deepEqual(
        result.choices,
        expected.map((c) => ({
          id: c.id,
          position: c.position,
          text: c.text,
          isCorrect: c.is_correct
        }))
      );
      assert.equal(result.score, i % 7 === 0 ? null : 1);
      assert.deepEqual(Object.keys(redacted).sort(), [
        'answer',
        'choices',
        'id',
        'kind',
        'position',
        'prompt'
      ]);
      assert.ok('choices' in redacted);
      assert.deepEqual(
        redacted.choices,
        expected.map((c) => ({ id: c.id, position: c.position, text: c.text }))
      );
    }

    assert.equal(
      result.grading,
      i % 7 === 0 ? 'unanswered' : result.score === null ? 'ungraded' : 'graded'
    );
  }
});

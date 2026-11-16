import { quizAttemptCompletedSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { OrderingResult } from './ordering-result';

test.stable('completed ordering shows the learner and correct sequences separately', () => {
  const attempt = Schema.decodeUnknownSync(quizAttemptCompletedSchema)({
    id: 1n,
    versionId: 2n,
    materialId: 3n,
    startedAt: 1n,
    finishedAt: 2n,
    status: 'completed',
    scoring: { complete: true, gradedCount: 1, questionCount: 1, earned: 0, score: 0 },
    questions: [
      {
        id: 4n,
        position: 0n,
        kind: 'ordering',
        prompt: 'Order',
        items: [
          { id: 9n, text: 'Last' },
          { id: 7n, text: 'First' },
          { id: 8n, text: 'Middle' }
        ],
        answer: { type: 'ordering', itemIds: [7n, 9n, 8n] },
        correctItemIds: [7n, 8n, 9n],
        explanation: 'First, middle, last.',
        score: 0,
        feedback: null,
        grading: 'graded'
      }
    ]
  });
  const question = attempt.questions[0]!;

  test.assert.ok(question.kind === 'ordering');

  test.render(<OrderingResult question={question} />);
  const learner = test.screen.getByRole('list', { name: catalogs.english.YourAnswer });
  const correct = test.screen.getByRole('list', { name: catalogs.english.RightAnswer });

  test
    .expect(
      test
        .within(learner)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    )
    .toEqual(['1First', '2Last', '3Middle']);
  test
    .expect(
      test
        .within(correct)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    )
    .toEqual(['1First', '2Middle', '3Last']);
  test.expect(test.screen.queryByRole('button')).not.toBeInTheDocument();
});

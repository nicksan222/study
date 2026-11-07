import { quizAttemptCompletedSchema } from '@study/contracts/learning/schemas';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen, within } from '@testing-library/react';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { MatchingReview } from './matching-review';

const a = '11111111-1111-4111-8111-111111111111';

const b = '22222222-2222-4222-8222-222222222222';

const x = '33333333-3333-4333-8333-333333333333';

const y = '44444444-4444-4444-8444-444444444444';

testStable('matching review labels selected and correct associations for each term', () => {
  const attempt = Schema.decodeUnknownSync(quizAttemptCompletedSchema)({
    id: 1n,
    versionId: 2n,
    materialId: 3n,
    startedAt: 1n,
    finishedAt: 2n,
    status: 'completed',
    scoring: { complete: true, questionCount: 1, gradedCount: 1, earned: 0, score: 0 },
    questions: [
      {
        id: 4n,
        position: 0n,
        kind: 'matching',
        prompt: 'Match',
        explanation: 'Cell functions.',
        score: 0,
        feedback: null,
        grading: 'graded',
        terms: [
          { id: a, text: 'Nucleus' },
          { id: b, text: 'Ribosome' }
        ],
        definitions: [
          { id: y, text: 'Builds proteins' },
          { id: x, text: 'Stores DNA' }
        ],
        answer: {
          type: 'matching',
          associations: [
            { termId: a, definitionId: y },
            { termId: b, definitionId: x }
          ]
        },
        pairs: [
          { termId: a, definitionId: x, score: 0 },
          { termId: b, definitionId: y, score: 0 }
        ]
      }
    ]
  });
  const question = attempt.questions[0]!;

  expect(question.kind).toBe('matching');

  if (question.kind !== 'matching') throw Error('wrong fixture');

  render(<MatchingReview question={question} />);
  const nucleus = screen.getByText('Nucleus').parentElement!;

  expect(within(nucleus).getByText(catalogs.english.YourAnswer + ':')).toBeInTheDocument();
  expect(within(nucleus).getByText(catalogs.english.RightAnswer + ':')).toBeInTheDocument();
  expect(within(nucleus).getByText('Builds proteins')).toBeInTheDocument();
  expect(within(nucleus).getByText('Stores DNA')).toBeInTheDocument();
  expect(within(nucleus).getByText(catalogs.english.VerdictIncorrect)).toBeInTheDocument();
});

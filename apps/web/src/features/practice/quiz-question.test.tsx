import { quizAttemptInProgressSchema } from '@study/contracts/learning/schemas';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { QuizQuestion } from './quiz-question';

const attempt = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
  id: 1n,
  versionId: 2n,
  materialId: 3n,
  startedAt: 1n,
  status: 'in_progress',
  questions: [
    {
      id: 4n,
      position: 0n,
      kind: 'multiple_choice',
      prompt: 'Which are prime?',
      answer: null,
      choices: [
        { id: 5n, position: 0n, text: 'Two' },
        { id: 6n, position: 1n, text: 'Three' }
      ]
    }
  ]
});

testStable('requires an answer and preserves multiple selections when submitting', async () => {
  const submit = vi.fn();
  const user = userEvent.setup();

  render(<QuizQuestion question={attempt.questions[0]!} pending={false} submit={submit} last />);
  expect(screen.getByRole('button', { name: catalogs.english.SubmitAnswer })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /Two/ }));
  await user.click(screen.getByRole('checkbox', { name: /Three/ }));
  await user.click(screen.getByRole('button', { name: catalogs.english.SubmitAnswer }));
  expect(submit).toHaveBeenCalledWith({ type: 'choice', choiceIds: [5n, 6n] });
});

testStable('selects answers by number and submits from the keyboard', async () => {
  const submit = vi.fn();
  const user = userEvent.setup();

  render(<QuizQuestion question={attempt.questions[0]!} pending={false} submit={submit} last />);
  await user.keyboard('12{Enter}');
  expect(submit).toHaveBeenCalledWith({ type: 'choice', choiceIds: [5n, 6n] });
});

testStable('keeps open answers editable and submits trimmed text', async () => {
  const submit = vi.fn();
  const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
    ...attempt,
    questions: [
      { id: 4n, position: 0n, kind: 'open', prompt: 'Explain prime numbers.', answer: null }
    ]
  }).questions[0]!;
  const user = userEvent.setup();

  render(<QuizQuestion question={question} pending={false} submit={submit} last />);
  await user.type(
    screen.getByRole('textbox', { name: catalogs.english.YourAnswer }),
    '  Exactly two divisors.  '
  );
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(submit).toHaveBeenCalledWith({ type: 'open', answer: 'Exactly two divisors.' });
});

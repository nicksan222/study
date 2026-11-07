import { quizAttemptInProgressSchema } from '@study/contracts/learning/schemas';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { LanguageProvider } from '#web/lib/i18n.tsx';

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

testStable(
  'blank answers restore saved text and submit with Enter without leaking the answer',
  async () => {
    const submit = vi.fn();
    const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
      ...attempt,
      questions: [
        {
          id: 4n,
          position: 0n,
          kind: 'fill_blank',
          prompt: 'A prime has ____ divisors.',
          answer: { type: 'open', answer: 'three' }
        }
      ]
    }).questions[0]!;
    const user = userEvent.setup();

    render(<QuizQuestion question={question} pending={false} submit={submit} last />);
    const input = screen.getByRole('textbox', { name: catalogs.english.YourAnswer });

    expect(input).toHaveValue('three');
    await user.clear(input);
    expect(screen.getByRole('button', { name: catalogs.english.SubmitAnswer })).toBeDisabled();
    await user.type(input, '  two  {Enter}');
    expect(submit).toHaveBeenCalledExactlyOnceWith({ type: 'open', answer: 'two' });
  }
);

testStable('confirming an IME composition does not submit a blank answer', () => {
  const submit = vi.fn();
  const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
    ...attempt,
    questions: [
      {
        id: 4n,
        position: 0n,
        kind: 'fill_blank',
        prompt: 'The word is ____.',
        answer: { type: 'open', answer: '日本語' }
      }
    ]
  }).questions[0]!;

  render(<QuizQuestion question={question} pending={false} submit={submit} last />);
  const input = screen.getByRole('textbox', { name: catalogs.english.YourAnswer });

  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', isComposing: false });
  expect(submit).toHaveBeenCalledExactlyOnceWith({ type: 'open', answer: '日本語' });
});

testStable(
  'matching restores associations and supports keyboard selection without submitting from a select',
  async () => {
    const submit = vi.fn();
    const termA = '11111111-1111-4111-8111-111111111111';
    const termB = '22222222-2222-4222-8222-222222222222';
    const definitionA = '33333333-3333-4333-8333-333333333333';
    const definitionB = '44444444-4444-4444-8444-444444444444';
    const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
      ...attempt,
      questions: [
        {
          id: 4n,
          position: 0n,
          kind: 'matching',
          prompt: 'Match cell components.',
          terms: [
            { id: termA, text: 'Nucleus' },
            { id: termB, text: 'Ribosome' }
          ],
          definitions: [
            { id: definitionB, text: 'Builds proteins' },
            { id: definitionA, text: 'Stores DNA' }
          ],
          answer: {
            type: 'matching',
            associations: [
              { termId: termA, definitionId: definitionB },
              { termId: termB, definitionId: definitionA }
            ]
          }
        }
      ]
    }).questions[0]!;
    const user = userEvent.setup();

    render(<QuizQuestion question={question} pending={false} submit={submit} last />);
    const nucleus = screen.getByRole('combobox', { name: 'Nucleus' });
    const ribosome = screen.getByRole('combobox', { name: 'Ribosome' });

    expect(nucleus).toHaveTextContent('Builds proteins');
    expect(ribosome).toHaveTextContent('Stores DNA');
    nucleus.focus();
    await user.keyboard('{Enter}');
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('option', { name: 'Stores DNA' }));
    expect(screen.getByRole('button', { name: catalogs.english.SubmitAnswer })).toBeDisabled();
    await user.click(ribosome);
    await user.click(screen.getByRole('option', { name: 'Builds proteins' }));
    await user.click(screen.getByRole('button', { name: catalogs.english.SubmitAnswer }));
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      type: 'matching',
      associations: [
        { termId: termA, definitionId: definitionA },
        { termId: termB, definitionId: definitionB }
      ]
    });
  }
);
testStable('true or false restores a single radio response and uses localized labels', async () => {
  const submit = vi.fn();
  const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
    ...attempt,
    questions: [
      {
        id: 4n,
        position: 0n,
        kind: 'true_false',
        prompt: 'ATP carries energy.',
        answer: { type: 'choice', choiceIds: [6n] },
        choices: [
          { id: 5n, position: 0n, text: 'true' },
          { id: 6n, position: 1n, text: 'false' }
        ]
      }
    ]
  }).questions[0]!;
  const user = userEvent.setup();

  render(<QuizQuestion question={question} pending={false} submit={submit} last />);
  expect(screen.getByRole('radio', { name: /False/ })).toBeChecked();
  await user.click(screen.getByRole('radio', { name: /True/ }));
  expect(screen.getByRole('radio', { name: /False/ })).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: catalogs.english.SubmitAnswer }));
  expect(submit).toHaveBeenCalledExactlyOnceWith({ type: 'choice', choiceIds: [5n] });
});

testStable('Italian true or false controls localize canonical truth tokens', () => {
  const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
    ...attempt,
    questions: [
      {
        id: 4n,
        position: 0n,
        kind: 'true_false',
        prompt: 'ATP trasporta energia.',
        answer: null,
        choices: [
          { id: 5n, position: 0n, text: 'true' },
          { id: 6n, position: 1n, text: 'false' }
        ]
      }
    ]
  }).questions[0]!;

  render(
    <LanguageProvider locale="italian">
      <QuizQuestion question={question} pending={false} submit={() => {}} last />
    </LanguageProvider>
  );
  expect(screen.getByRole('radio', { name: /Vero/ })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Falso/ })).toBeInTheDocument();
});

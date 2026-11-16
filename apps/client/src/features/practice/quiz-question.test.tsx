import { quizAttemptInProgressSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type { AiReadiness } from '#client/lib/ai-readiness.ts';
import { LanguageProvider } from '#client/lib/i18n.tsx';

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

test.stable('requires an answer and preserves multiple selections when submitting', async () => {
  const submit = test.vi.fn();
  const user = test.userEvent.setup();

  test.render(
    <QuizQuestion question={attempt.questions[0]!} pending={false} submit={submit} last />
  );
  test
    .expect(test.screen.getByRole('button', { name: catalogs.english.SubmitAnswer }))
    .toBeDisabled();
  await user.click(test.screen.getByRole('checkbox', { name: /Two/ }));
  await user.click(test.screen.getByRole('checkbox', { name: /Three/ }));
  await user.click(test.screen.getByRole('button', { name: catalogs.english.SubmitAnswer }));
  test.expect(submit).toHaveBeenCalledWith({ type: 'choice', choiceIds: [5n, 6n] });
});

test.stable('selects answers by number and submits from the keyboard', async () => {
  const submit = test.vi.fn();
  const user = test.userEvent.setup();

  test.render(
    <QuizQuestion question={attempt.questions[0]!} pending={false} submit={submit} last />
  );
  await user.keyboard('12{Enter}');
  test.expect(submit).toHaveBeenCalledWith({ type: 'choice', choiceIds: [5n, 6n] });
});

test.stable('keeps open answers editable and submits trimmed text', async () => {
  const submit = test.vi.fn();
  const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
    ...attempt,
    questions: [
      { id: 4n, position: 0n, kind: 'open', prompt: 'Explain prime numbers.', answer: null }
    ]
  }).questions[0]!;
  const user = test.userEvent.setup();

  test.render(<QuizQuestion question={question} pending={false} submit={submit} last />);
  await user.type(
    test.screen.getByRole('textbox', { name: catalogs.english.YourAnswer }),
    '  Exactly two divisors.  '
  );
  await user.keyboard('{Control>}{Enter}{/Control}');
  test.expect(submit).toHaveBeenCalledWith({ type: 'open', answer: 'Exactly two divisors.' });
});

test.stable(
  'blank answers restore saved text and submit with Enter without leaking the answer',
  async () => {
    const submit = test.vi.fn();
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
    const user = test.userEvent.setup();

    test.render(<QuizQuestion question={question} pending={false} submit={submit} last />);
    const input = test.screen.getByRole('textbox', { name: catalogs.english.YourAnswer });

    test.expect(input).toHaveValue('three');
    await user.clear(input);
    test
      .expect(test.screen.getByRole('button', { name: catalogs.english.SubmitAnswer }))
      .toBeDisabled();
    await user.type(input, '  two  {Enter}');
    test.expect(submit).toHaveBeenCalledExactlyOnceWith({ type: 'open', answer: 'two' });
  }
);

test.stable('confirming an IME composition does not submit a blank answer', () => {
  const submit = test.vi.fn();
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

  test.render(<QuizQuestion question={question} pending={false} submit={submit} last />);
  const input = test.screen.getByRole('textbox', { name: catalogs.english.YourAnswer });

  test.expect(test.fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
  test.expect(submit).not.toHaveBeenCalled();
  test.fireEvent.keyDown(input, { key: 'Enter', isComposing: false });
  test.expect(submit).toHaveBeenCalledExactlyOnceWith({ type: 'open', answer: '日本語' });
});

test.stable(
  'matching restores associations and supports keyboard selection without submitting from a select',
  async () => {
    const submit = test.vi.fn();
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
    const user = test.userEvent.setup();

    test.render(<QuizQuestion question={question} pending={false} submit={submit} last />);
    const nucleus = test.screen.getByRole('combobox', { name: 'Nucleus' });
    const ribosome = test.screen.getByRole('combobox', { name: 'Ribosome' });

    test.expect(nucleus).toHaveTextContent('Builds proteins');
    test.expect(ribosome).toHaveTextContent('Stores DNA');
    nucleus.focus();
    await user.keyboard('{Enter}');
    test.expect(submit).not.toHaveBeenCalled();
    await user.click(await test.screen.findByRole('option', { name: 'Stores DNA' }));
    test
      .expect(test.screen.getByRole('button', { name: catalogs.english.SubmitAnswer }))
      .toBeDisabled();
    await user.click(ribosome);
    await user.click(await test.screen.findByRole('option', { name: 'Builds proteins' }));
    await user.click(test.screen.getByRole('button', { name: catalogs.english.SubmitAnswer }));
    test.expect(submit).toHaveBeenCalledExactlyOnceWith({
      type: 'matching',
      associations: [
        { termId: termA, definitionId: definitionA },
        { termId: termB, definitionId: definitionB }
      ]
    });
  }
);
test.stable(
  'true or false restores a single radio response and uses localized labels',
  async () => {
    const submit = test.vi.fn();
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
    const user = test.userEvent.setup();

    test.render(<QuizQuestion question={question} pending={false} submit={submit} last />);
    test.expect(test.screen.getByRole('radio', { name: /False/ })).toBeChecked();
    await user.click(test.screen.getByRole('radio', { name: /True/ }));
    test.expect(test.screen.getByRole('radio', { name: /False/ })).not.toBeChecked();
    await user.click(test.screen.getByRole('button', { name: catalogs.english.SubmitAnswer }));
    test.expect(submit).toHaveBeenCalledExactlyOnceWith({ type: 'choice', choiceIds: [5n] });
  }
);

test.stable('Italian true or false controls localize canonical truth tokens', () => {
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

  test.render(
    <LanguageProvider locale="italian">
      <QuizQuestion question={question} pending={false} submit={() => {}} last />
    </LanguageProvider>
  );
  test.expect(test.screen.getByRole('radio', { name: /Vero/ })).toBeInTheDocument();
  test.expect(test.screen.getByRole('radio', { name: /Falso/ })).toBeInTheDocument();
});

test.stable(
  'ordering restores saved permutations and moves steps with keyboard buttons',
  async () => {
    const submit = test.vi.fn();
    const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
      ...attempt,
      questions: [
        {
          id: 4n,
          position: 0n,
          kind: 'ordering',
          prompt: 'Order the stages.',
          items: [
            { id: 9n, text: 'Third' },
            { id: 7n, text: 'First' },
            { id: 8n, text: 'Second' }
          ],
          answer: { type: 'ordering', itemIds: [7n, 9n, 8n] }
        }
      ]
    }).questions[0]!;
    const user = test.userEvent.setup();

    test.render(<QuizQuestion question={question} pending={false} submit={submit} last />);
    test
      .expect(test.screen.getAllByRole('listitem').map((item) => item.textContent))
      .toEqual([
        test.expect.stringContaining('First'),
        test.expect.stringContaining('Third'),
        test.expect.stringContaining('Second')
      ]);
    const move = test.screen.getAllByRole('button', { name: catalogs.english.PracticeMoveUp })[2]!;

    move.focus();
    await user.keyboard('{Enter}');
    test.expect(submit).not.toHaveBeenCalled();
    await user.click(test.screen.getByRole('button', { name: catalogs.english.SubmitAnswer }));
    test
      .expect(submit)
      .toHaveBeenCalledExactlyOnceWith({ type: 'ordering', itemIds: [7n, 8n, 9n] });
  }
);

const readiness = test.hoisted(() => ({ value: 'ready' as AiReadiness }));

test.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => readiness.value }));
test.mock('#client/lib/ai-readiness-notice.tsx', () => ({ AiReadinessNotice: () => null }));
test.afterEach(() => {
  readiness.value = 'ready';
});

test.stable('preserves typed answers but blocks AI grading until setup is ready', async () => {
  readiness.value = 'setup';
  const submit = test.vi.fn();
  const question = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
    ...attempt,
    questions: [{ id: 4n, position: 0n, kind: 'open', prompt: 'Explain cells.', answer: null }]
  }).questions[0]!;
  const user = test.userEvent.setup();

  test.render(<QuizQuestion question={question} pending={false} submit={submit} last />);
  const answer = test.screen.getByRole('textbox', { name: catalogs.english.YourAnswer });

  await user.type(answer, 'Cells are basic units of life.');
  test.expect(answer).toBeEnabled();
  test
    .expect(test.screen.getByRole('button', { name: catalogs.english.SubmitAnswer }))
    .toBeDisabled();
  await user.keyboard('{Control>}{Enter}{/Control}');
  test.expect(submit).not.toHaveBeenCalled();
});

test.stable('keeps deterministic answers usable without provider setup', async () => {
  readiness.value = 'setup';
  const submit = test.vi.fn();
  const user = test.userEvent.setup();

  test.render(
    <QuizQuestion question={attempt.questions[0]!} pending={false} submit={submit} last />
  );
  await user.keyboard('12{Enter}');
  test.expect(submit).toHaveBeenCalledWith({ type: 'choice', choiceIds: [5n, 6n] });
});

import {
  quizAttemptCompletedSchema,
  quizAttemptInProgressSchema
} from '@study/contracts/learning/schemas';
import type { quizAttemptSchema } from '@study/contracts/learning/schemas';
import {
  materialDetailSchema,
  materialVersionDetailSchema
} from '@study/contracts/materials/schemas';
import { defaultQuizSettings } from '@study/contracts/settings/types';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import {
  learningVersion,
  materialRpc,
  mountLibraryRoute
} from '#client/features/material-library/test/support.tsx';
import type { StudyClient } from '#client/lib/study-client/client.ts';

vi.mock('#client/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const en = catalogs.english;

const choice = {
  id: 4n,
  position: 0n,
  kind: 'single_choice',
  prompt: 'Which number is prime?',
  choices: [
    { id: 5n, position: 0n, text: 'Two' },
    { id: 6n, position: 1n, text: 'Four' }
  ],
  answer: { type: 'choice', choiceIds: [5n] }
};

const initial = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
  id: 70n,
  versionId: 102n,
  materialId: 41n,
  status: 'in_progress',
  startedAt: 1000n,
  questions: [
    choice,
    { id: 7n, position: 1n, kind: 'open', prompt: 'Explain divisibility.', answer: null }
  ]
});

const completed = Schema.decodeUnknownSync(quizAttemptCompletedSchema)({
  ...initial,
  id: 71n,
  status: 'completed',
  startedAt: 2000n,
  finishedAt: 3000n,
  scoring: { complete: true, gradedCount: 2, questionCount: 2, earned: 2, score: 1 },
  questions: [
    {
      ...choice,
      explanation: 'A prime number has exactly two divisors.',
      score: 1,
      feedback: null,
      grading: 'graded',
      choices: choice.choices.map((option) => ({ ...option, isCorrect: option.id === 5n }))
    },
    {
      id: 7n,
      position: 1n,
      kind: 'fill_blank',
      prompt: 'Two is a ____ number.',
      answer: { type: 'open', answer: 'prime' },
      referenceAnswer: 'prime',
      explanation: 'Two has exactly two divisors.',
      score: 1,
      feedback: null,
      grading: 'graded'
    }
  ]
});

function summary(attempt: typeof quizAttemptSchema.Type) {
  return {
    materialId: attempt.materialId,
    attempt: {
      id: attempt.id,
      version_id: attempt.versionId,
      status: attempt.status,
      started_at: attempt.startedAt,
      finished_at: attempt.status === 'completed' ? attempt.finishedAt : null
    }
  };
}

function mount(empty = false, italian = false) {
  const rpc = materialRpc();

  if (italian)
    rpc['settings.appSettings'].mockReturnValue(
      Effect.succeed({ language: 2, appearance: 2, zoomPercent: 100, onboarded: true })
    );

  const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
    ...learningVersion(102n),
    kind: 'quiz',
    content: { kind: 'quiz', questions: completed.questions }
  });
  const material = Schema.decodeUnknownSync(materialDetailSchema)({
    id: 41n,
    kind: 'quiz',
    title: 'Number theory',
    projectIds: [],
    created_at: 1n,
    updated_at: 1n,
    archived_at: null,
    version,
    latestPublishedVersion: version,
    latestDraftVersion: null
  });

  rpc['materials.material'].mockReturnValue(Effect.succeed(material));
  const transport = {
    ...rpc,
    'settings.quizSettings': vi
      .fn<StudyClient['settings.quizSettings']>()
      .mockReturnValue(Effect.succeed(defaultQuizSettings)),
    'learning.attempts': vi.fn<StudyClient['learning.attempts']>().mockReturnValue(
      Effect.succeed({
        items: empty ? [] : [summary(initial), summary(completed)],
        nextCursor: null
      })
    ),
    'learning.attempt': vi
      .fn<StudyClient['learning.attempt']>()
      .mockImplementation(({ attemptId }) =>
        Effect.succeed(attemptId === completed.id ? completed : initial)
      ),
    'learning.startQuiz': vi.fn<StudyClient['learning.startQuiz']>(),
    'learning.answerQuestion': vi.fn<StudyClient['learning.answerQuestion']>(),
    'learning.finishQuiz': vi.fn<StudyClient['learning.finishQuiz']>()
  };

  return { ...mountLibraryRoute('/practice/41', transport), rpc: transport };
}

async function openHistory(user: ReturnType<typeof userEvent.setup>, italian = false) {
  const copy = italian ? catalogs.italian : en;

  await user.click(await screen.findByRole('button', { name: copy.PracticeActions }));
  await user.click(screen.getByRole('button', { name: copy.PracticeAttempts }));

  return screen.findByRole('dialog', { name: copy.PracticeAttempts });
}

testStable(
  'automatically previews saved answers and resumes the same attempt without creating or changing one',
  async () => {
    const { rpc, router } = mount();
    const user = userEvent.setup();
    const dialog = await openHistory(user);

    expect(await within(dialog).findByText(en.PracticeResumeHelp)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Two/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Two/ })).toBeDisabled();
    expect(within(dialog).queryByRole('textbox', { name: en.YourAnswer })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: en.NextQuestion }));
    expect(within(dialog).getByRole('textbox', { name: en.YourAnswer })).toHaveAttribute(
      'readonly'
    );
    expect(within(dialog).queryByRole('radio', { name: /Two/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: en.QuizPrevious }));
    expect(within(dialog).getByRole('radio', { name: /Two/ })).toBeChecked();
    expect(within(dialog).getByRole('progressbar')).toHaveAttribute('value', '1');
    expect(within(dialog).queryByText('A prime number has exactly two divisors.')).toBeNull();
    const resume = within(dialog).getByRole('link', { name: en.PracticeResume });

    expect(resume).toHaveAttribute('href', '/practice/41?attempt=70');
    await user.click(resume);
    await waitFor(() => expect(router.state.location.search.attempt).toBe('70'));
    expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
    expect(rpc['learning.answerQuestion']).not.toHaveBeenCalled();
    expect(rpc['learning.finishQuiz']).not.toHaveBeenCalled();
  }
);

testStable(
  'searches statuses and automatically renders completed attempts with the existing results view',
  async () => {
    const { rpc } = mount();
    const user = userEvent.setup();
    const dialog = await openHistory(user);

    await within(dialog).findByText(en.PracticeResumeHelp);
    await user.type(
      within(dialog).getByRole('searchbox', { name: en.PracticeSearchAttempts }),
      en.PracticeAttemptCompleted
    );
    expect(
      await within(dialog).findByRole('heading', { name: en.PracticeOverallResults })
    ).toBeInTheDocument();
    expect(within(within(dialog).getByRole('banner')).getByText('100%')).toBeInTheDocument();
    expect(
      within(dialog).getByText('A prime number has exactly two divisors.')
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.PracticeNextQuestion }));
    expect(within(dialog).getByRole('group', { name: en.YourAnswer })).toHaveTextContent('prime');
    expect(within(dialog).getByRole('group', { name: en.RightAnswer })).toHaveTextContent('prime');
    expect(within(dialog).queryByRole('textbox', { name: en.YourAnswer })).toBeNull();
    expect(within(dialog).queryByRole('link', { name: en.PracticeResume })).toBeNull();
    expect(rpc['learning.attempt']).toHaveBeenLastCalledWith({ attemptId: completed.id });
    await user.clear(within(dialog).getByRole('searchbox', { name: en.PracticeSearchAttempts }));
    await user.type(
      within(dialog).getByRole('searchbox', { name: en.PracticeSearchAttempts }),
      'no matching attempt'
    );
    expect(await within(dialog).findByRole('status')).toHaveTextContent(en.SearchNoResults);
    expect(within(dialog).getByRole('status')).toHaveClass('ui-selection-empty');
  }
);

testStable(
  'shows the shared empty state when no attempts exist without requesting an attempt',
  async () => {
    const { rpc } = mount(true);
    const user = userEvent.setup();
    const dialog = await openHistory(user);

    expect(await within(dialog).findByRole('status')).toHaveTextContent(en.PracticeNoAttempts);
    expect(within(dialog).queryByRole('link', { name: en.PracticeResume })).toBeNull();
    expect(rpc['learning.attempt']).not.toHaveBeenCalled();
  }
);

testStable('saved true or false history uses localized radio controls', async () => {
  const { rpc } = mount();

  rpc['learning.attempt'].mockReturnValue(
    Effect.succeed(
      Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
        ...initial,
        questions: [
          {
            ...choice,
            kind: 'true_false',
            prompt: 'ATP carries energy.',
            choices: [
              { id: 5n, position: 0n, text: 'true' },
              { id: 6n, position: 1n, text: 'false' }
            ]
          }
        ]
      })
    )
  );
  const dialog = await openHistory(userEvent.setup());

  expect(await within(dialog).findByRole('radio', { name: /True/ })).toBeChecked();
  expect(within(dialog).getByRole('radio', { name: /False/ })).toBeDisabled();
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
});

testStable('saved true or false history uses Italian radio controls', async () => {
  const { rpc } = mount(false, true);

  rpc['learning.attempt'].mockReturnValue(
    Effect.succeed(
      Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
        ...initial,
        questions: [
          {
            ...choice,
            kind: 'true_false',
            prompt: 'ATP carries energy.',
            choices: [
              { id: 5n, position: 0n, text: 'true' },
              { id: 6n, position: 1n, text: 'false' }
            ]
          }
        ]
      })
    )
  );
  const dialog = await openHistory(userEvent.setup(), true);

  expect(await within(dialog).findByRole('radio', { name: /Vero/ })).toBeChecked();
  expect(within(dialog).getByRole('radio', { name: /Falso/ })).toBeDisabled();
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
});

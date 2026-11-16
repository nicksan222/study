import {
  quizAttemptCompletedSchema,
  quizAttemptInProgressSchema,
  materialDetailSchema,
  materialVersionDetailSchema,
  defaultQuizSettings
} from '@study/contracts';
import type { quizAttemptSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import {
  learningVersion,
  materialRpc,
  mountLibraryRoute
} from '#client/features/material-library/test/support.tsx';

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
    'settings.quizSettings': test.vi
      .fn<StudyClient['settings.quizSettings']>()
      .mockReturnValue(Effect.succeed(defaultQuizSettings)),
    'learning.attempts': test.vi.fn<StudyClient['learning.attempts']>().mockReturnValue(
      Effect.succeed({
        items: empty ? [] : [summary(initial), summary(completed)],
        nextCursor: null
      })
    ),
    'learning.attempt': test.vi
      .fn<StudyClient['learning.attempt']>()
      .mockImplementation(({ attemptId }) =>
        Effect.succeed(attemptId === completed.id ? completed : initial)
      ),
    'learning.startQuiz': test.vi.fn<StudyClient['learning.startQuiz']>(),
    'learning.answerQuestion': test.vi.fn<StudyClient['learning.answerQuestion']>(),
    'learning.finishQuiz': test.vi.fn<StudyClient['learning.finishQuiz']>()
  };

  return { ...mountLibraryRoute('/practice/41', transport), rpc: transport };
}

async function openHistory(user: ReturnType<typeof test.userEvent.setup>, italian = false) {
  const copy = italian ? catalogs.italian : en;

  await user.click(await test.screen.findByRole('button', { name: copy.PracticeActions }));
  await user.click(test.screen.getByRole('button', { name: copy.PracticeAttempts }));

  return test.screen.findByRole('dialog', { name: copy.PracticeAttempts });
}

test.stable(
  'automatically previews saved answers and resumes the same attempt without creating or changing one',
  async () => {
    const { rpc, router } = mount();
    const user = test.userEvent.setup();
    const dialog = await openHistory(user);

    test.expect(await test.within(dialog).findByText(en.PracticeResumeHelp)).toBeInTheDocument();
    test.expect(test.within(dialog).getByRole('radio', { name: /Two/ })).toBeChecked();
    test.expect(test.within(dialog).getByRole('radio', { name: /Two/ })).toBeDisabled();
    test.expect(test.within(dialog).queryByRole('textbox', { name: en.YourAnswer })).toBeNull();
    await user.click(test.within(dialog).getByRole('button', { name: en.NextQuestion }));
    test
      .expect(test.within(dialog).getByRole('textbox', { name: en.YourAnswer }))
      .toHaveAttribute('readonly');
    test.expect(test.within(dialog).queryByRole('radio', { name: /Two/ })).toBeNull();
    await user.click(test.within(dialog).getByRole('button', { name: en.QuizPrevious }));
    test.expect(test.within(dialog).getByRole('radio', { name: /Two/ })).toBeChecked();
    test.expect(test.within(dialog).getByRole('progressbar')).toHaveAttribute('value', '1');
    test
      .expect(test.within(dialog).queryByText('A prime number has exactly two divisors.'))
      .toBeNull();
    const resume = test.within(dialog).getByRole('link', { name: en.PracticeResume });

    test.expect(resume).toHaveAttribute('href', '/practice/41?attempt=70');
    await user.click(resume);
    await test.waitFor(() => test.expect(router.state.location.search.attempt).toBe('70'));
    test.expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
    test.expect(rpc['learning.answerQuestion']).not.toHaveBeenCalled();
    test.expect(rpc['learning.finishQuiz']).not.toHaveBeenCalled();
  }
);

test.stable(
  'searches statuses and automatically renders completed attempts with the existing results view',
  async () => {
    const { rpc } = mount();
    const user = test.userEvent.setup();
    const dialog = await openHistory(user);

    await test.within(dialog).findByText(en.PracticeResumeHelp);
    await user.type(
      test.within(dialog).getByRole('searchbox', { name: en.PracticeSearchAttempts }),
      en.PracticeAttemptCompleted
    );
    test
      .expect(await test.within(dialog).findByRole('heading', { name: en.PracticeOverallResults }))
      .toBeInTheDocument();
    test
      .expect(test.within(test.within(dialog).getByRole('banner')).getByText('100%'))
      .toBeInTheDocument();
    test
      .expect(test.within(dialog).getByText('A prime number has exactly two divisors.'))
      .toBeInTheDocument();
    await user.click(test.within(dialog).getByRole('button', { name: en.PracticeNextQuestion }));
    test
      .expect(test.within(dialog).getByRole('group', { name: en.YourAnswer }))
      .toHaveTextContent('prime');
    test
      .expect(test.within(dialog).getByRole('group', { name: en.RightAnswer }))
      .toHaveTextContent('prime');
    test.expect(test.within(dialog).queryByRole('textbox', { name: en.YourAnswer })).toBeNull();
    test.expect(test.within(dialog).queryByRole('link', { name: en.PracticeResume })).toBeNull();
    test.expect(rpc['learning.attempt']).toHaveBeenLastCalledWith({ attemptId: completed.id });
    await user.clear(
      test.within(dialog).getByRole('searchbox', { name: en.PracticeSearchAttempts })
    );
    await user.type(
      test.within(dialog).getByRole('searchbox', { name: en.PracticeSearchAttempts }),
      'no matching attempt'
    );
    test
      .expect(await test.within(dialog).findByRole('status'))
      .toHaveTextContent(en.SearchNoResults);
    test.expect(test.within(dialog).getByRole('status')).toHaveClass('ui-selection-empty');
  }
);

test.stable(
  'shows the shared empty state when no attempts exist without requesting an attempt',
  async () => {
    const { rpc } = mount(true);
    const user = test.userEvent.setup();
    const dialog = await openHistory(user);

    test
      .expect(await test.within(dialog).findByRole('status'))
      .toHaveTextContent(en.PracticeNoAttempts);
    test.expect(test.within(dialog).queryByRole('link', { name: en.PracticeResume })).toBeNull();
    test.expect(rpc['learning.attempt']).not.toHaveBeenCalled();
  }
);

test.stable('saved true or false history uses localized radio controls', async () => {
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
  const dialog = await openHistory(test.userEvent.setup());

  test.expect(await test.within(dialog).findByRole('radio', { name: /True/ })).toBeChecked();
  test.expect(test.within(dialog).getByRole('radio', { name: /False/ })).toBeDisabled();
  test.expect(test.within(dialog).queryByRole('checkbox')).toBeNull();
});

test.stable('saved true or false history uses Italian radio controls', async () => {
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
  const dialog = await openHistory(test.userEvent.setup(), true);

  test.expect(await test.within(dialog).findByRole('radio', { name: /Vero/ })).toBeChecked();
  test.expect(test.within(dialog).getByRole('radio', { name: /Falso/ })).toBeDisabled();
  test.expect(test.within(dialog).queryByRole('checkbox')).toBeNull();
});

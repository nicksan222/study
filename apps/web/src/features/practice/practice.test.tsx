import { StudyError } from '@study/contracts/errors';
import { materialIdSchema } from '@study/contracts/ids';
import { reviewedCardSchema, dueCardSchema } from '@study/contracts/learning/rpc';
import {
  quizAttemptCompletedSchema,
  quizAttemptInProgressSchema
} from '@study/contracts/learning/schemas';
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
} from '#web/features/material-library/test/support.tsx';
import type { StudyClient } from '#web/lib/study-client/client.ts';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const en = catalogs.english;

const question = {
  id: 4n,
  position: 0n,
  kind: 'single_choice',
  prompt: 'Which number is prime?',
  answer: null,
  choices: [
    { id: 5n, position: 0n, text: 'Two' },
    { id: 6n, position: 1n, text: 'Four' }
  ]
};

const initial = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
  id: 70n,
  versionId: 102n,
  materialId: 41n,
  startedAt: 1n,
  status: 'in_progress',
  questions: [question]
});

const answered = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
  ...initial,
  questions: [{ ...question, answer: { type: 'choice', choiceIds: [5n] } }]
});

const completed = Schema.decodeUnknownSync(quizAttemptCompletedSchema)({
  ...answered,
  status: 'completed',
  finishedAt: 2n,
  scoring: { complete: true, gradedCount: 1, questionCount: 1, earned: 1, score: 1 },
  questions: [
    {
      ...answered.questions[0],
      explanation: 'Two has exactly two divisors.',
      score: 1,
      feedback: null,
      grading: 'graded',
      choices: [
        { ...question.choices[0], isCorrect: true },
        { ...question.choices[1], isCorrect: false }
      ]
    }
  ]
});

function practiceRpc(kind: 'quiz' | 'flashcards' = 'quiz', scoped = false) {
  const rpc = materialRpc();
  const content =
    kind === 'quiz'
      ? {
          kind,
          questions: [
            {
              ...question,
              explanation: 'Two has exactly two divisors.',
              choices: [
                { ...question.choices[0], isCorrect: true },
                { ...question.choices[1], isCorrect: false }
              ]
            }
          ]
        }
      : {
          kind,
          cards: [
            {
              cardId: 11n,
              front: 'What is a prime number?',
              back: 'A whole number with exactly two divisors.'
            },
            { cardId: 12n, front: 'Name the smallest prime.', back: 'Two.' }
          ]
        };
  const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
    ...learningVersion(102n),
    kind,
    content
  });
  const material = Schema.decodeUnknownSync(materialDetailSchema)({
    id: 41n,
    kind,
    title: 'Number theory',
    projectIds: scoped ? [1n] : [],
    created_at: 1n,
    updated_at: 1n,
    archived_at: null,
    version,
    latestPublishedVersion: version,
    latestDraftVersion: null
  });

  rpc['materials.material'].mockReturnValue(Effect.succeed(material));

  return {
    ...rpc,
    fixture: material,
    'settings.quizSettings': vi
      .fn<StudyClient['settings.quizSettings']>()
      .mockReturnValue(Effect.succeed(defaultQuizSettings)),
    'settings.saveQuizSettings': vi
      .fn<StudyClient['settings.saveQuizSettings']>()
      .mockImplementation((input) => Effect.succeed(input)),
    'materials.archive': vi
      .fn<StudyClient['materials.archive']>()
      .mockReturnValue(Effect.succeed({ ...material, archived_at: 2n })),
    'materials.unarchive': vi
      .fn<StudyClient['materials.unarchive']>()
      .mockReturnValue(Effect.succeed(material)),
    'learning.dueCards': vi
      .fn<StudyClient['learning.dueCards']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'learning.attempts': vi
      .fn<StudyClient['learning.attempts']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'learning.startQuiz': vi
      .fn<StudyClient['learning.startQuiz']>()
      .mockReturnValue(Effect.succeed(initial)),
    'learning.attempt': vi
      .fn<StudyClient['learning.attempt']>()
      .mockReturnValue(Effect.succeed(initial)),
    'learning.answerQuestion': vi
      .fn<StudyClient['learning.answerQuestion']>()
      .mockReturnValue(Effect.succeed(answered)),
    'learning.finishQuiz': vi
      .fn<StudyClient['learning.finishQuiz']>()
      .mockReturnValue(Effect.succeed(completed)),
    'learning.answerPracticeQuestion': vi
      .fn<StudyClient['learning.answerPracticeQuestion']>()
      .mockReturnValue(Effect.succeed(answered)),
    'learning.reviewCard': vi.fn<StudyClient['learning.reviewCard']>()
  };
}

testStable(
  'starts a quiz at its material path, saves an answer, and displays completed results',
  async () => {
    const rpc = practiceRpc();
    const user = userEvent.setup();
    const { router } = mountLibraryRoute('/practice/41', rpc);

    await user.click(await screen.findByRole('button', { name: en.PracticeStartQuiz }));
    await screen.findByRole('heading', { name: question.prompt });
    expect(router.state.location.pathname).toBe('/practice/41');
    expect(router.state.location.search.attempt).toBe('70');
    await user.click(screen.getByRole('radio', { name: /Two/ }));
    await user.click(screen.getByRole('button', { name: en.SubmitAnswer }));
    await user.click(await screen.findByRole('button', { name: en.PracticeFinishQuiz }));
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Two has exactly two divisors.')).toBeInTheDocument();
    expect(rpc['learning.answerQuestion']).toHaveBeenCalledExactlyOnceWith({
      attemptId: initial.id,
      questionId: question.id,
      answer: { type: 'choice', choiceIds: [5n] }
    });
  }
);

testStable('rejects a foreign attempt without exposing its questions', async () => {
  const rpc = practiceRpc();

  rpc['learning.attempt'].mockReturnValue(
    Effect.succeed({ ...initial, materialId: Schema.decodeUnknownSync(materialIdSchema)(99n) })
  );
  mountLibraryRoute('/practice/41?attempt=70', rpc);

  expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
    en.ReaderUnavailable
  );
  expect(screen.queryByText(question.prompt)).not.toBeInTheDocument();
  expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
});

testStable(
  'keeps a failed card rating on the revealed card and leaves successful ratings to the scheduler',
  async () => {
    const rpc = practiceRpc('flashcards');
    const review = Schema.decodeUnknownSync(reviewedCardSchema)({
      snapshot: {
        version_id: 102n,
        material_id: 41n,
        card_id: 11n,
        position: 0n,
        front: 'Prime',
        back: 'Two divisors'
      },
      schedule: {
        card_id: 11n,
        due: 100n,
        last_review: 1n,
        elapsed_days: 0n,
        scheduled_days: 1n,
        learning_steps: 0n,
        state: 'learning',
        stability: 1,
        difficulty: 1,
        reps: 1n,
        lapses: 0n
      },
      review: {
        id: 1n,
        card_id: 11n,
        version_id: 102n,
        reviewed_at: 1n,
        rating: 'again',
        elapsed_days: 0
      }
    });

    rpc['learning.reviewCard']
      .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'temporarily unavailable')))
      .mockReturnValue(Effect.succeed(review));
    const user = userEvent.setup();

    mountLibraryRoute('/flashcards/41', rpc);

    expect(await screen.findByText('What is a prime number?')).toBeInTheDocument();
    expect(screen.queryByText('A whole number with exactly two divisors.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.ShowAnswer }));
    await user.click(screen.getByRole('button', { name: en.RateAgain }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.PracticeActionError);
    expect(screen.getByText('A whole number with exactly two divisors.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.RateAgain }));
    await screen.findByText('Name the smallest prime.');
    await user.click(screen.getByRole('button', { name: en.ShowAnswer }));
    await user.click(screen.getByRole('button', { name: en.RateGood }));
    expect(await screen.findByText(en.PracticeReviewComplete)).toBeInTheDocument();
    await waitFor(() =>
      expect(rpc['learning.reviewCard']).toHaveBeenLastCalledWith({
        versionId: initial.versionId,
        cardId: 12n,
        rating: 'good'
      })
    );
  }
);

testStable('resumes a saved attempt directly without creating another', async () => {
  const rpc = practiceRpc();

  mountLibraryRoute('/practice/41?attempt=70', rpc);

  expect(await screen.findByRole('heading', { name: question.prompt })).toBeInTheDocument();
  expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
});

testStable('rejects a flashcard material opened through a quiz path', async () => {
  const rpc = practiceRpc('flashcards');

  mountLibraryRoute('/practice/41', rpc);

  expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
    en.PracticeUnavailable
  );
  expect(screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
});

testStable('answers a generated practice attempt through its owning slot', async () => {
  const rpc = practiceRpc();
  const slotId = '123e4567-e89b-42d3-a456-426614174000';

  rpc['learning.attempt'].mockReturnValue(Effect.succeed({ ...initial, practiceSlotId: slotId }));
  const user = userEvent.setup();

  mountLibraryRoute('/practice/41?attempt=70', rpc);

  await user.click(await screen.findByRole('radio', { name: /Two/ }));
  await user.click(screen.getByRole('button', { name: en.SubmitAnswer }));
  await screen.findByRole('button', { name: en.PracticeFinishQuiz });
  expect(rpc['learning.answerPracticeQuestion']).toHaveBeenCalledExactlyOnceWith({
    slotId,
    answer: { type: 'choice', choiceIds: [5n] }
  });
  expect(rpc['learning.answerQuestion']).not.toHaveBeenCalled();
});

testStable('opens the immutable version used by a saved quiz attempt', async () => {
  const rpc = practiceRpc();

  mountLibraryRoute('/practice/41?attempt=70', rpc);

  await userEvent.setup().click(await screen.findByRole('button', { name: en.PracticeActions }));
  await waitFor(() =>
    expect(screen.getByRole('link', { name: en.PracticeViewMaterial })).toHaveAttribute(
      'href',
      '/materials/41?version=102'
    )
  );
});

testStable('reviews only cards returned by the persisted due-card queue', async () => {
  const rpc = practiceRpc('flashcards', true);
  const card = Schema.decodeUnknownSync(dueCardSchema)({
    snapshot: {
      version_id: 102n,
      material_id: 41n,
      card_id: 12n,
      position: 1n,
      front: 'Name the smallest prime.',
      back: 'Two.'
    },
    schedule: null,
    due: 0n
  });

  rpc['learning.dueCards'].mockReturnValue(Effect.succeed({ items: [card], nextCursor: null }));
  mountLibraryRoute('/flashcards/41', rpc);

  expect(await screen.findByText('Name the smallest prime.')).toBeInTheDocument();
  expect(screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
  expect(rpc['learning.dueCards']).toHaveBeenCalledExactlyOnceWith({
    projectId: 1n,
    limit: 100,
    cursor: undefined
  });
});

testStable('shows that no review is due instead of replaying already scheduled cards', async () => {
  const rpc = practiceRpc('flashcards', true);

  mountLibraryRoute('/flashcards/41', rpc);

  expect(await screen.findByText(en.PracticeNothingDue)).toBeInTheDocument();
  expect(screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
});

testStable(
  'uses the shared actions card and keeps the current answer when reviewing attempts',
  async () => {
    const rpc = practiceRpc();

    rpc['learning.attempts'].mockReturnValue(
      Effect.succeed({
        items: [
          {
            materialId: initial.materialId,
            attempt: {
              id: initial.id,
              version_id: initial.versionId,
              status: 'in_progress',
              started_at: initial.startedAt,
              finished_at: null
            }
          }
        ],
        nextCursor: null
      })
    );
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41?attempt=70', rpc);

    await user.click(await screen.findByRole('radio', { name: /Two/ }));
    const toggle = screen.getByRole('button', { name: en.PracticeActions });

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: en.PracticeAttempts }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeAttempts });

    expect(await within(dialog).findByText(en.PracticeResumeHelp)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.Close }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeAttempts })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('radio', { name: /Two/ })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: en.PracticeAttempts })).toHaveFocus()
    );
    expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
  }
);

testStable(
  'keeps the selected subject after archiving material shared by multiple subjects',
  async () => {
    const rpc = practiceRpc();
    const material = Schema.decodeUnknownSync(materialDetailSchema)({
      ...rpc.fixture,
      projectIds: [1n, 2n]
    });

    rpc['materials.material'].mockReturnValue(Effect.succeed(material));
    rpc['materials.archive'].mockReturnValue(Effect.succeed({ ...material, archived_at: 2n }));
    const user = userEvent.setup();
    const { router } = mountLibraryRoute('/practice/41?project=2', rpc);

    await user.click(await screen.findByRole('button', { name: en.PracticeActions }));
    await user.click(screen.getByRole('button', { name: en.PracticeArchiveMaterial }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/practice'));
    expect(router.state.location.search.project).toBe('2');
  }
);

testStable(
  'reviews saved answers and edits them before finishing in the same action footer',
  async () => {
    const rpc = practiceRpc();

    rpc['learning.attempt'].mockReturnValue(Effect.succeed(answered));
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41?attempt=70', rpc);
    await screen.findByRole('heading', { name: en.QuizReviewAnswers });
    const finish = screen.getByRole('button', { name: en.PracticeFinishQuiz });

    expect(finish.parentElement).toHaveClass('study-practice-stage-footer');
    expect(screen.getByText('Two')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Edit answer/ }));
    expect(await screen.findByRole('radio', { name: /Two/ })).toBeChecked();
    expect(screen.getByRole('button', { name: en.SubmitAnswer }).parentElement).toHaveClass(
      'study-practice-stage-footer'
    );
    await user.click(screen.getByRole('button', { name: en.QuizBackToReview }));
    await user.click(screen.getByRole('button', { name: en.PracticeFinishQuiz }));
    await screen.findByText('100%');
    expect(screen.getByRole('link', { name: en.PracticeTryAgain }).parentElement).toHaveClass(
      'study-practice-stage-footer'
    );
    expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
  }
);

testStable(
  'keeps preferences in Settings and shows exact document sources without Archived',
  async () => {
    const rpc = practiceRpc();
    const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
      ...rpc.fixture.latestPublishedVersion,
      inputs: [
        { kind: 'document', versionId: 8n },
        { kind: 'source', sourceId: 7n, revision: 1n, snapshotId: 9n }
      ]
    });

    rpc['materials.materialVersion'].mockReturnValue(Effect.succeed(version));
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41', rpc);
    await screen.findByRole('button', { name: en.PracticeStartQuiz });
    expect(screen.queryByRole('combobox', { name: en.QuizQuestionCount })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.PracticeActions }));
    expect(await screen.findByText(en.PracticeSourceDocuments)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Material 41' })).toHaveAttribute(
      'href',
      '/documents/41?documentVersion=8'
    );
    expect(
      within(screen.getByRole('complementary', { name: en.PracticeActions })).queryByRole(
        'button',
        { name: en.PracticeArchived }
      )
    ).not.toBeInTheDocument();
    expect(rpc['documents.version']).toHaveBeenCalledWith({ id: 8n });
    expect(rpc['sources.source']).not.toHaveBeenCalled();
  }
);

testStable(
  'explicitly replays the full flashcard deck when no scheduled review is due',
  async () => {
    const rpc = practiceRpc('flashcards', true);
    const user = userEvent.setup();

    mountLibraryRoute('/flashcards/41', rpc);
    await screen.findByText(en.PracticeNothingDue);
    await user.click(screen.getByRole('button', { name: en.PracticeReplayFlashcards }));
    expect(await screen.findByText('What is a prime number?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: new RegExp(en.ShowAnswer) }));
    expect(screen.getByText('A whole number with exactly two divisors.')).toBeInTheDocument();
    expect(rpc['learning.reviewCard']).not.toHaveBeenCalled();
  }
);

import {
  StudyError,
  materialIdSchema,
  reviewedCardSchema,
  dueCardSchema,
  quizAttemptCompletedSchema,
  quizAttemptInProgressSchema,
  materialDetailSchema,
  materialVersionDetailSchema,
  defaultQuizSettings
} from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import {
  learningVersion,
  materialRpc,
  mountLibraryRoute
} from '#client/features/material-library/test/support.tsx';

test.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));

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

  let persistedAttempt: typeof initial | typeof completed = initial;
  const handlers = {
    ...rpc,
    fixture: material,
    'settings.quizSettings': test.vi
      .fn<StudyClient['settings.quizSettings']>()
      .mockReturnValue(Effect.succeed(defaultQuizSettings)),
    'settings.saveQuizSettings': test.vi
      .fn<StudyClient['settings.saveQuizSettings']>()
      .mockImplementation((input) => Effect.succeed(input)),
    'materials.archive': test.vi
      .fn<StudyClient['materials.archive']>()
      .mockReturnValue(Effect.succeed({ ...material, archived_at: 2n })),
    'materials.unarchive': test.vi
      .fn<StudyClient['materials.unarchive']>()
      .mockReturnValue(Effect.succeed(material)),
    'learning.dueCards': test.vi
      .fn<StudyClient['learning.dueCards']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'learning.attempts': test.vi
      .fn<StudyClient['learning.attempts']>()
      .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
    'learning.startQuiz': test.vi
      .fn<StudyClient['learning.startQuiz']>()
      .mockReturnValue(Effect.succeed(initial)),
    'learning.attempt': test.vi
      .fn<StudyClient['learning.attempt']>()
      .mockImplementation(() => Effect.succeed(persistedAttempt)),
    'learning.answerQuestion': test.vi
      .fn<StudyClient['learning.answerQuestion']>()
      .mockImplementation(() =>
        Effect.sync(() => {
          persistedAttempt = answered;
          handlers['learning.attempt'].mockReturnValue(Effect.succeed(answered));

          return answered;
        })
      ),
    'learning.finishQuiz': test.vi.fn<StudyClient['learning.finishQuiz']>().mockImplementation(() =>
      Effect.sync(() => {
        persistedAttempt = completed;
        handlers['learning.attempt'].mockReturnValue(Effect.succeed(completed));

        return completed;
      })
    ),
    'learning.answerPracticeQuestion': test.vi
      .fn<StudyClient['learning.answerPracticeQuestion']>()
      .mockImplementation(() =>
        Effect.sync(() => {
          persistedAttempt = answered;
          handlers['learning.attempt'].mockReturnValue(Effect.succeed(answered));

          return answered;
        })
      ),
    'learning.reviewCard': test.vi.fn<StudyClient['learning.reviewCard']>()
  };

  return handlers;
}

test.stable(
  'starts a quiz at its material path, saves an answer, and displays completed results',
  async () => {
    const rpc = practiceRpc();
    const user = test.userEvent.setup();
    const { router } = mountLibraryRoute('/practice/41', rpc);

    const start = await test.screen.findByRole('button', { name: en.PracticeStartQuiz });

    await test.waitFor(() => test.expect(start).toBeEnabled());
    await user.click(start);
    await test.screen.findByRole('heading', { name: question.prompt });
    test.expect(router.state.location.pathname).toBe('/practice/41');
    test.expect(router.state.location.search.attempt).toBe('70');
    await user.click(test.screen.getByRole('radio', { name: /Two/ }));
    await user.click(test.screen.getByRole('button', { name: en.SubmitAnswer }));
    await user.click(await test.screen.findByRole('button', { name: en.PracticeFinishQuiz }));
    test.expect(await test.screen.findByText('100%')).toBeInTheDocument();
    test.expect(test.screen.getByText('Two has exactly two divisors.')).toBeInTheDocument();
    test.expect(rpc['learning.answerQuestion']).toHaveBeenCalledExactlyOnceWith({
      attemptId: initial.id,
      questionId: question.id,
      answer: { type: 'choice', choiceIds: [5n] }
    });
  }
);

test.stable('rejects a foreign attempt without exposing its questions', async () => {
  const rpc = practiceRpc();

  rpc['learning.attempt'].mockReturnValue(
    Effect.succeed({ ...initial, materialId: Schema.decodeUnknownSync(materialIdSchema)(99n) })
  );
  mountLibraryRoute('/practice/41?attempt=70', rpc);

  test
    .expect(await test.within(await test.screen.findByRole('main')).findByRole('alert'))
    .toHaveTextContent(en.ReaderUnavailable);
  test.expect(test.screen.queryByText(question.prompt)).not.toBeInTheDocument();
  test.expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
});

test.stable(
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
    const user = test.userEvent.setup();

    mountLibraryRoute('/flashcards/41', rpc);

    test.expect(await test.screen.findByText('What is a prime number?')).toBeInTheDocument();
    test
      .expect(test.screen.queryByText('A whole number with exactly two divisors.'))
      .not.toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: en.ShowAnswer }));
    await user.click(test.screen.getByRole('button', { name: en.RateAgain }));
    test.expect(await test.screen.findByRole('alert')).toHaveTextContent(en.PracticeActionError);
    test
      .expect(test.screen.getByText('A whole number with exactly two divisors.'))
      .toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: en.RateAgain }));
    await test.screen.findByText('Name the smallest prime.');
    await user.click(test.screen.getByRole('button', { name: en.ShowAnswer }));
    await user.click(test.screen.getByRole('button', { name: en.RateGood }));
    test.expect(await test.screen.findByText(en.PracticeReviewComplete)).toBeInTheDocument();
    await test.waitFor(() =>
      test.expect(rpc['learning.reviewCard']).toHaveBeenLastCalledWith({
        versionId: initial.versionId,
        cardId: 12n,
        rating: 'good'
      })
    );
  }
);

test.stable('resumes a saved attempt directly without creating another', async () => {
  const rpc = practiceRpc();

  mountLibraryRoute('/practice/41?attempt=70', rpc);

  test
    .expect(await test.screen.findByRole('heading', { name: question.prompt }))
    .toBeInTheDocument();
  test.expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
});

test.stable('rejects a flashcard material opened through a quiz path', async () => {
  const rpc = practiceRpc('flashcards');

  mountLibraryRoute('/practice/41', rpc);

  test
    .expect(await test.within(await test.screen.findByRole('main')).findByRole('alert'))
    .toHaveTextContent(en.PracticeUnavailable);
  test.expect(test.screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
});

test.stable('answers a generated practice attempt through its owning slot', async () => {
  const rpc = practiceRpc();
  const slotId = '123e4567-e89b-42d3-a456-426614174000';

  rpc['learning.attempt'].mockReturnValue(Effect.succeed({ ...initial, practiceSlotId: slotId }));
  const user = test.userEvent.setup();

  mountLibraryRoute('/practice/41?attempt=70', rpc);

  await user.click(await test.screen.findByRole('radio', { name: /Two/ }));
  await user.click(test.screen.getByRole('button', { name: en.SubmitAnswer }));
  await test.screen.findByRole('button', { name: en.PracticeFinishQuiz });
  test.expect(rpc['learning.answerPracticeQuestion']).toHaveBeenCalledExactlyOnceWith({
    slotId,
    answer: { type: 'choice', choiceIds: [5n] }
  });
  test.expect(rpc['learning.answerQuestion']).not.toHaveBeenCalled();
});

test.stable('opens the immutable version used by a saved quiz attempt', async () => {
  const rpc = practiceRpc();

  mountLibraryRoute('/practice/41?attempt=70', rpc);

  await test.userEvent
    .setup()
    .click(await test.screen.findByRole('button', { name: en.PracticeActions }));
  await test.waitFor(() =>
    test
      .expect(test.screen.getByRole('link', { name: en.PracticeViewMaterial }))
      .toHaveAttribute('href', '/materials/41?version=102')
  );
});

test.stable('reviews only cards returned by the persisted due-card queue', async () => {
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

  test.expect(await test.screen.findByText('Name the smallest prime.')).toBeInTheDocument();
  test.expect(test.screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
  test.expect(rpc['learning.dueCards']).toHaveBeenCalledExactlyOnceWith({
    projectId: 1n,
    limit: 100,
    cursor: undefined
  });
});

test.stable(
  'shows that no review is due instead of replaying already scheduled cards',
  async () => {
    const rpc = practiceRpc('flashcards', true);

    mountLibraryRoute('/flashcards/41', rpc);

    test.expect(await test.screen.findByText(en.PracticeNothingDue)).toBeInTheDocument();
    test.expect(test.screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
  }
);

test.stable(
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
    const user = test.userEvent.setup();

    mountLibraryRoute('/practice/41?attempt=70', rpc);

    await user.click(await test.screen.findByRole('radio', { name: /Two/ }));
    const toggle = test.screen.getByRole('button', { name: en.PracticeActions });

    await user.click(toggle);
    await user.click(test.screen.getByRole('button', { name: en.PracticeAttempts }));
    const dialog = await test.screen.findByRole('dialog', { name: en.PracticeAttempts });

    test.expect(await test.within(dialog).findByText(en.PracticeResumeHelp)).toBeInTheDocument();
    await user.click(test.within(dialog).getByRole('button', { name: en.Close }));
    await test.waitFor(() =>
      test
        .expect(test.screen.queryByRole('dialog', { name: en.PracticeAttempts }))
        .not.toBeInTheDocument()
    );
    test.expect(test.screen.getByRole('radio', { name: /Two/ })).toBeChecked();
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: en.PracticeAttempts })).toHaveFocus()
    );
    test.expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps the selected subject after archiving material shared by multiple subjects',
  async () => {
    const rpc = practiceRpc();
    const material = Schema.decodeUnknownSync(materialDetailSchema)({
      ...rpc.fixture,
      projectIds: [1n, 2n]
    });

    rpc['materials.material'].mockReturnValue(Effect.succeed(material));
    rpc['materials.archive'].mockReturnValue(Effect.succeed({ ...material, archived_at: 2n }));
    const user = test.userEvent.setup();
    const { router } = mountLibraryRoute('/practice/41?project=2', rpc);

    await user.click(await test.screen.findByRole('button', { name: en.PracticeActions }));
    await user.click(test.screen.getByRole('button', { name: en.PracticeArchiveMaterial }));
    await test.waitFor(() => test.expect(router.state.location.pathname).toBe('/practice'));
    test.expect(router.state.location.search.project).toBe('2');
  }
);

test.stable(
  'reviews saved answers and edits them before finishing in the same action footer',
  async () => {
    const rpc = practiceRpc();

    rpc['learning.attempt'].mockReturnValue(Effect.succeed(answered));
    const user = test.userEvent.setup();

    mountLibraryRoute('/practice/41?attempt=70', rpc);
    await test.screen.findByRole('heading', { name: en.QuizReviewAnswers });
    const finish = test.screen.getByRole('button', { name: en.PracticeFinishQuiz });

    test.expect(finish.parentElement).toHaveClass('study-practice-stage-footer');
    test.expect(test.screen.getByText('Two')).toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: /Edit answer/ }));
    test.expect(await test.screen.findByRole('radio', { name: /Two/ })).toBeChecked();
    test
      .expect(test.screen.getByRole('button', { name: en.SubmitAnswer }).parentElement)
      .toHaveClass('study-practice-stage-footer');
    await user.click(test.screen.getByRole('button', { name: en.QuizBackToReview }));
    await user.click(test.screen.getByRole('button', { name: en.PracticeFinishQuiz }));
    await test.screen.findByText('100%');
    test
      .expect(test.screen.getByRole('link', { name: en.PracticeTryAgain }).parentElement)
      .toHaveClass('study-practice-stage-footer');
    test.expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps preferences in Settings and shows exact document sources without Archived',
  async () => {
    const rpc = practiceRpc();
    const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
      ...rpc.fixture.latestPublishedVersion,
      inputs: [
        { kind: 'page', versionId: 8n },
        { kind: 'source', sourceId: 7n, revision: 1n, snapshotId: 9n }
      ]
    });

    rpc['materials.materialVersion'].mockReturnValue(Effect.succeed(version));
    const user = test.userEvent.setup();

    mountLibraryRoute('/practice/41', rpc);
    await test.screen.findByRole('button', { name: en.PracticeStartQuiz });
    test
      .expect(test.screen.queryByRole('combobox', { name: en.QuizQuestionCount }))
      .not.toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: en.PracticeActions }));
    test.expect(await test.screen.findByText(en.PracticeSourcePages)).toBeInTheDocument();
    test
      .expect(
        await test
          .within(test.screen.getByRole('complementary', { name: en.PracticeActions }))
          .findByRole('link', { name: 'Material 41' })
      )
      .toHaveAttribute('href', '/pages/41?pageVersion=8');
    test
      .expect(
        test
          .within(test.screen.getByRole('complementary', { name: en.PracticeActions }))
          .queryByRole('button', { name: en.PracticeArchived })
      )
      .not.toBeInTheDocument();
    test.expect(rpc['pages.version']).toHaveBeenCalledWith({ id: 8n });
    test.expect(rpc['sources.source']).not.toHaveBeenCalled();
  }
);

test.stable(
  'explicitly replays the full flashcard deck when no scheduled review is due',
  async () => {
    const rpc = practiceRpc('flashcards', true);
    const user = test.userEvent.setup();

    mountLibraryRoute('/flashcards/41', rpc);
    await test.screen.findByText(en.PracticeNothingDue);
    await user.click(test.screen.getByRole('button', { name: en.PracticeReplayFlashcards }));
    test.expect(await test.screen.findByText('What is a prime number?')).toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: new RegExp(en.ShowAnswer) }));
    test
      .expect(test.screen.getByText('A whole number with exactly two divisors.'))
      .toBeInTheDocument();
    test.expect(rpc['learning.reviewCard']).not.toHaveBeenCalled();
  }
);

test.stable(
  'reviews text answers as labeled read-only content and keeps multiline feedback separate',
  async () => {
    const rpc = practiceRpc();
    const learnerAnswer =
      'La membrana regola gli scambi.\nMantiene condizioni adatte alla cellula.';
    const referenceAnswer =
      'La membrana è selettivamente permeabile.\nControlla il passaggio delle sostanze.';
    const result = Schema.decodeUnknownSync(quizAttemptCompletedSchema)({
      ...completed,
      questions: [
        {
          id: 7n,
          position: 0n,
          kind: 'open',
          prompt: 'Spiega la funzione della membrana.',
          answer: { type: 'open', answer: learnerAnswer },
          referenceAnswer,
          explanation:
            'La permeabilità selettiva mantiene l’omeostasi.\nLe proteine regolano il trasporto.',
          feedback: 'Hai descritto la funzione.\nPrecisa il ruolo della permeabilità selettiva.',
          score: 0.5,
          grading: 'graded'
        }
      ]
    });

    rpc['learning.attempt'].mockReturnValue(Effect.succeed(result));
    mountLibraryRoute('/practice/41?attempt=70', rpc);

    const review = await test.screen.findByRole('region', { name: en.PracticeResults });

    test
      .expect(test.within(review).getByRole('group', { name: en.YourAnswer }))
      .toHaveTextContent(learnerAnswer.replace('\n', ' '));
    test
      .expect(test.within(review).getByRole('group', { name: en.RightAnswer }))
      .toHaveTextContent(referenceAnswer.replace('\n', ' '));
    test.expect(test.within(review).queryByRole('textbox')).toBeNull();
    test.expect(test.within(review).getByText(en.VerdictPartly)).toBeInTheDocument();
    test
      .expect(test.within(review).getByRole('heading', { name: en.PracticeFeedback }))
      .toBeInTheDocument();
    test
      .expect(test.within(review).getByRole('heading', { name: en.PracticeArchiveExplanation }))
      .toBeInTheDocument();
    test.expect(rpc['learning.answerQuestion']).not.toHaveBeenCalled();
  }
);

test.stable(
  'distinguishes pending grading from unanswered text and preserves result navigation',
  async () => {
    const rpc = practiceRpc();
    const result = Schema.decodeUnknownSync(quizAttemptCompletedSchema)({
      ...completed,
      scoring: { complete: false, gradedCount: 0, questionCount: 2, earned: 0, score: null },
      questions: [
        {
          id: 7n,
          position: 0n,
          kind: 'fill_blank',
          prompt: 'Proteins are assembled by ____.',
          answer: { type: 'open', answer: 'ribosomes' },
          referenceAnswer: 'ribosomes',
          explanation: 'Ribosomes assemble proteins.',
          feedback: null,
          score: null,
          grading: 'ungraded'
        },
        {
          id: 8n,
          position: 1n,
          kind: 'open',
          prompt: 'Explain transport.',
          answer: null,
          referenceAnswer: null,
          explanation: 'Transport moves substances.',
          feedback: null,
          score: null,
          grading: 'unanswered'
        }
      ]
    });

    rpc['learning.attempt'].mockReturnValue(Effect.succeed(result));
    mountLibraryRoute('/practice/41?attempt=70', rpc);
    const review = await test.screen.findByRole('region', { name: en.PracticeResults });

    test
      .expect(test.within(review).getByRole('group', { name: en.YourAnswer }))
      .toHaveTextContent('ribosomes');
    test.expect(test.within(review).getByText(en.PracticeUngraded)).toBeInTheDocument();
    test.expect(test.within(review).queryByText('100%')).toBeNull();
    test.expect(test.within(review).getByText(en.PracticeScorePending)).toBeInTheDocument();
    await test.userEvent
      .setup()
      .click(test.within(review).getByRole('button', { name: en.PracticeNextQuestion }));
    test
      .expect(test.within(review).getByRole('group', { name: en.YourAnswer }))
      .toHaveTextContent(en.PracticeUnanswered);
    test
      .expect(test.within(review).getByRole('group', { name: en.RightAnswer }))
      .toHaveTextContent(en.PracticeUngraded);
    test
      .expect(test.within(review).getByRole('button', { name: en.PracticeNextQuestion }))
      .toBeDisabled();
    test.expect(test.within(review).getByRole('button', { name: en.QuizPrevious })).toBeEnabled();
  }
);

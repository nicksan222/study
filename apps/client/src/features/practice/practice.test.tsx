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

import type * as __MockType0 from '#client/features/material-library/test/support.tsx';

let learningVersion: typeof __MockType0.learningVersion;

let materialRpc: typeof __MockType0.materialRpc;

let mountLibraryRoute: typeof __MockType0.mountLibraryRoute;

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

function practiceRpc(
  { vi }: Pick<test.unit.Context, 'vi'>,
  kind: 'quiz' | 'flashcards' = 'quiz',
  scoped = false
) {
  const rpc = materialRpc({ vi });
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
      .mockImplementation(() => Effect.succeed(persistedAttempt)),
    'learning.answerQuestion': vi
      .fn<StudyClient['learning.answerQuestion']>()
      .mockImplementation(() =>
        Effect.sync(() => {
          persistedAttempt = answered;
          handlers['learning.attempt'].mockReturnValue(Effect.succeed(answered));

          return answered;
        })
      ),
    'learning.finishQuiz': vi.fn<StudyClient['learning.finishQuiz']>().mockImplementation(() =>
      Effect.sync(() => {
        persistedAttempt = completed;
        handlers['learning.attempt'].mockReturnValue(Effect.succeed(completed));

        return completed;
      })
    ),
    'learning.answerPracticeQuestion': vi
      .fn<StudyClient['learning.answerPracticeQuestion']>()
      .mockImplementation(() =>
        Effect.sync(() => {
          persistedAttempt = answered;
          handlers['learning.attempt'].mockReturnValue(Effect.succeed(answered));

          return answered;
        })
      ),
    'learning.reviewCard': vi.fn<StudyClient['learning.reviewCard']>()
  };

  return handlers;
}

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));
  const __mockModule0 = await import('#client/features/material-library/test/support.tsx');

  learningVersion = __mockModule0.learningVersion;
  materialRpc = __mockModule0.materialRpc;
  mountLibraryRoute = __mockModule0.mountLibraryRoute;
});

test.unit.stable(
  'starts a quiz at its material path, saves an answer, and displays completed results',
  async ({ userEvent, screen, waitFor, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });
    const user = userEvent.setup();
    const { router } = mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41', rpc);

    const start = await screen.findByRole('button', { name: en.PracticeStartQuiz });

    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    await screen.findByRole('heading', { name: question.prompt });
    expect(router.state.location.pathname).toBe('/practice/41');
    expect(router.state.location.search.attempt).toBe('70');
    await user.click(screen.getByRole('radio', { name: /Two/ }));
    await user.click(screen.getByRole('button', { name: en.SubmitAnswer }));
    await user.click(await screen.findByRole('button', { name: en.PracticeNextQuestion }));
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

test.unit.stable(
  'rejects a foreign attempt without exposing its questions',
  async ({ expect, within, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });

    rpc['learning.attempt'].mockReturnValue(
      Effect.succeed({ ...initial, materialId: Schema.decodeUnknownSync(materialIdSchema)(99n) })
    );
    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);

    expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
      en.ReaderUnavailable
    );
    expect(screen.queryByText(question.prompt)).not.toBeInTheDocument();
    expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'keeps a failed card rating on the revealed card and leaves successful ratings to the scheduler',
  async ({ userEvent, expect, screen, waitFor, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi }, 'flashcards');
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

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/flashcards/41', rpc);

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

test.unit.stable(
  'resumes a saved attempt directly without creating another',
  async ({ expect, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);

    expect(await screen.findByRole('heading', { name: question.prompt })).toBeInTheDocument();
    expect(rpc['learning.startQuiz']).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'rejects a flashcard material opened through a quiz path',
  async ({ expect, within, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi }, 'flashcards');

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41', rpc);

    expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
      en.PracticeUnavailable
    );
    expect(screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'answers a generated practice attempt through its owning slot',
  async ({ userEvent, screen, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });
    const slotId = '123e4567-e89b-42d3-a456-426614174000';

    rpc['learning.attempt'].mockReturnValue(Effect.succeed({ ...initial, practiceSlotId: slotId }));
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);

    await user.click(await screen.findByRole('radio', { name: /Two/ }));
    await user.click(screen.getByRole('button', { name: en.SubmitAnswer }));
    await user.click(await screen.findByRole('button', { name: en.PracticeNextQuestion }));
    await screen.findByRole('button', { name: en.PracticeFinishQuiz });
    expect(rpc['learning.answerPracticeQuestion']).toHaveBeenCalledExactlyOnceWith({
      slotId,
      answer: { type: 'choice', choiceIds: [5n] }
    });
    expect(rpc['learning.answerQuestion']).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'opens the immutable version used by a saved quiz attempt',
  async ({ userEvent, screen, waitFor, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);

    await userEvent.setup().click(await screen.findByRole('button', { name: en.PracticeActions }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: en.PracticeViewMaterial })).toHaveAttribute(
        'href',
        '/materials/41?version=102'
      )
    );
  }
);

test.unit.stable(
  'reviews only cards returned by the persisted due-card queue',
  async ({ expect, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi }, 'flashcards', true);
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
    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/flashcards/41', rpc);

    expect(await screen.findByText('Name the smallest prime.')).toBeInTheDocument();
    expect(screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
    expect(rpc['learning.dueCards']).toHaveBeenCalledExactlyOnceWith({
      projectId: 1n,
      limit: 100,
      cursor: undefined
    });
  }
);

test.unit.stable(
  'shows that no review is due instead of replaying already scheduled cards',
  async ({ expect, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi }, 'flashcards', true);

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/flashcards/41', rpc);

    expect(await screen.findByText(en.PracticeNothingDue)).toBeInTheDocument();
    expect(screen.queryByText('What is a prime number?')).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'uses the shared actions card and keeps the current answer when reviewing attempts',
  async ({ userEvent, screen, expect, within, waitFor, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });

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

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);

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

test.unit.stable(
  'keeps the selected subject after archiving material shared by multiple subjects',
  async ({ userEvent, screen, waitFor, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });
    const material = Schema.decodeUnknownSync(materialDetailSchema)({
      ...rpc.fixture,
      projectIds: [1n, 2n]
    });

    rpc['materials.material'].mockReturnValue(Effect.succeed(material));
    rpc['materials.archive'].mockReturnValue(Effect.succeed({ ...material, archived_at: 2n }));
    const user = userEvent.setup();
    const { router } = mountLibraryRoute(
      { render, rpcHandlersTransport, vi },
      '/practice/41?project=2',
      rpc
    );

    await user.click(await screen.findByRole('button', { name: en.PracticeActions }));
    await user.click(screen.getByRole('button', { name: en.PracticeArchiveMaterial }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/practice'));
    expect(router.state.location.search.project).toBe('2');
  }
);

test.unit.stable(
  'reviews saved answers and edits them before finishing in the same action footer',
  async ({ userEvent, screen, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });

    rpc['learning.attempt'].mockReturnValue(Effect.succeed(answered));
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);
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

test.unit.stable(
  'keeps preferences in Settings and shows exact practice sources without Archived',
  async ({ userEvent, screen, expect, within, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });
    const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
      ...rpc.fixture.latestPublishedVersion,
      inputs: [
        { kind: 'page', versionId: 8n },
        { kind: 'source', sourceId: 7n, revision: 1n, snapshotId: 9n }
      ]
    });

    rpc['materials.materialVersion'].mockReturnValue(Effect.succeed(version));
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41', rpc);
    await screen.findByRole('button', { name: en.PracticeStartQuiz });
    expect(screen.queryByRole('combobox', { name: en.QuizQuestionCount })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.PracticeActions }));
    expect(await screen.findByText(en.PracticeEvidence)).toBeInTheDocument();
    expect(
      await within(screen.getByRole('complementary', { name: en.PracticeActions })).findByRole(
        'link',
        { name: 'Material 41' }
      )
    ).toHaveAttribute('href', '/pages/41?pageVersion=8');
    expect(
      within(screen.getByRole('complementary', { name: en.PracticeActions })).queryByRole(
        'button',
        { name: en.PracticeArchived }
      )
    ).not.toBeInTheDocument();
    expect(rpc['pages.version']).toHaveBeenCalledWith({ id: 8n });
    expect(rpc['sources.source']).toHaveBeenCalledWith({ id: 7n });
    expect(
      within(screen.getByRole('complementary', { name: en.PracticeActions }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toContain('/sources/7?sourceRevision=1&sourceSnapshot=9');
  }
);

test.unit.stable(
  'explicitly replays the full flashcard deck when no scheduled review is due',
  async ({ userEvent, screen, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi }, 'flashcards', true);
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/flashcards/41', rpc);
    await screen.findByText(en.PracticeNothingDue);
    await user.click(screen.getByRole('button', { name: en.PracticeReplayFlashcards }));
    expect(await screen.findByText('What is a prime number?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: new RegExp(en.ShowAnswer) }));
    expect(screen.getByText('A whole number with exactly two divisors.')).toBeInTheDocument();
    expect(rpc['learning.reviewCard']).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'reviews text answers as labeled read-only content and keeps multiline feedback separate',
  async ({ screen, expect, within, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });
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
    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);

    const review = await screen.findByRole('region', { name: en.PracticeResults });

    expect(within(review).getByRole('group', { name: en.YourAnswer })).toHaveTextContent(
      learnerAnswer.replace('\n', ' ')
    );
    expect(within(review).getByRole('group', { name: en.RightAnswer })).toHaveTextContent(
      referenceAnswer.replace('\n', ' ')
    );
    expect(within(review).queryByRole('textbox')).toBeNull();
    expect(within(review).getByText(en.VerdictPartly)).toBeInTheDocument();
    expect(within(review).getByRole('heading', { name: en.PracticeFeedback })).toBeInTheDocument();
    expect(
      within(review).getByRole('heading', { name: en.PracticeArchiveExplanation })
    ).toBeInTheDocument();
    expect(rpc['learning.answerQuestion']).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'distinguishes pending grading from unanswered text and preserves result navigation',
  async ({ screen, expect, within, userEvent, vi, render, rpcHandlersTransport }) => {
    const rpc = practiceRpc({ vi });
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
    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);
    const review = await screen.findByRole('region', { name: en.PracticeResults });

    expect(within(review).getByRole('group', { name: en.YourAnswer })).toHaveTextContent(
      'ribosomes'
    );
    expect(within(review).getByText(en.PracticeUngraded)).toBeInTheDocument();
    expect(within(review).queryByText('100%')).toBeNull();
    expect(within(review).getByText(en.PracticeScorePending)).toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(review).getByRole('button', { name: en.PracticeNextQuestion }));
    expect(within(review).getByRole('group', { name: en.YourAnswer })).toHaveTextContent(
      en.PracticeUnanswered
    );
    expect(within(review).getByRole('group', { name: en.RightAnswer })).toHaveTextContent(
      en.PracticeUngraded
    );
    expect(within(review).getByRole('button', { name: en.PracticeNextQuestion })).toBeDisabled();
    expect(within(review).getByRole('button', { name: en.QuizPrevious })).toBeEnabled();
  }
);

for (const [score, verdict] of [
  [1, 'VerdictCorrect'],
  [0, 'VerdictIncorrect'],
  [0.5, 'VerdictPartly'],
  [null, 'PracticeUngraded']
] as const)
  test.unit.stable(
    `immediate feedback pauses for the ${verdict} verdict before the final review`,
    async ({ userEvent, screen, waitFor, expect, vi, render, rpcHandlersTransport }) => {
      const rpc = practiceRpc({ vi });
      const user = userEvent.setup();
      const active = { ...initial, feedbackTiming: 'immediate' as const };
      const saved = {
        ...active,
        questions: answered.questions,
        results: [
          {
            ...completed.questions[0]!,
            score,
            feedback: 'Saved feedback',
            grading: score === null ? ('ungraded' as const) : ('graded' as const)
          }
        ]
      };

      rpc['learning.attempt'].mockReturnValue(Effect.succeed(active));
      rpc['learning.answerQuestion'].mockImplementation(() =>
        Effect.sync(() => {
          rpc['learning.attempt'].mockReturnValue(Effect.succeed(saved));

          return saved;
        })
      );
      mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);
      await user.click(await screen.findByRole('radio', { name: /Two/ }));
      await user.click(screen.getByRole('button', { name: en.SubmitAnswer }));
      expect(await screen.findByText(en[verdict], { exact: true })).toBeInTheDocument();
      expect(screen.getByText('Saved feedback')).toBeInTheDocument();
      expect(screen.getByText('Two has exactly two divisors.')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Correct answer/ })).toBeDisabled();
      expect(screen.queryByRole('button', { name: en.PracticeFinishQuiz })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: en.PracticeNextQuestion }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: en.PracticeFinishQuiz })).toBeEnabled()
      );
    }
  );

test.unit.stable(
  'uses the committed answer receipt while the live attempt snapshot is delayed',
  async ({ vi, render, rpcHandlersTransport, userEvent, screen, expect }) => {
    const rpc = practiceRpc({ vi });
    const saved = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
      ...answered,
      feedbackTiming: 'immediate',
      results: completed.questions
    });
    let hold = false;
    let release!: (value: typeof saved) => void;
    const snapshot = new Promise<typeof saved>((resolve) => {
      release = resolve;
    });

    rpc['learning.attempt'].mockImplementation(() =>
      hold
        ? Effect.promise(() => snapshot)
        : Effect.succeed({ ...initial, feedbackTiming: 'immediate' })
    );
    rpc['learning.answerQuestion'].mockImplementation(() =>
      Effect.sync(() => {
        hold = true;

        return saved;
      })
    );
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);
    await user.click(await screen.findByRole('radio', { name: /Two/ }));
    await user.click(screen.getByRole('button', { name: en.SubmitAnswer }));

    try {
      expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(en.VerdictCorrect);
      await user.click(screen.getByRole('button', { name: en.PracticeNextQuestion }));
      expect(await screen.findByRole('button', { name: en.PracticeFinishQuiz })).toBeEnabled();
    } finally {
      release(saved);
    }
  }
);

test.unit.stable(
  'hands a committed pending answer back to live grading when the query catches up',
  async ({ vi, render, rpcHandlersTransport, userEvent, screen, expect }) => {
    const rpc = practiceRpc({ vi });
    const textQuestion = {
      id: question.id,
      position: 0n,
      kind: 'open',
      prompt: 'Explain prime numbers.',
      answer: null
    };
    const before = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
      ...initial,
      feedbackTiming: 'immediate',
      questions: [textQuestion]
    });
    const saved = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
      ...before,
      questions: [{ ...textQuestion, answer: { type: 'open', answer: 'They are even.' } }],
      results: [
        {
          ...textQuestion,
          answer: { type: 'open', answer: 'They are even.' },
          referenceAnswer: 'They have exactly two divisors.',
          explanation: 'A prime has two divisors.',
          score: null,
          feedback: null,
          grading: 'ungraded'
        }
      ]
    });
    const graded = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
      ...saved,
      results: [
        {
          ...saved.results![0],
          score: 0,
          feedback: 'Live grading corrected the answer.',
          grading: 'graded'
        }
      ]
    });
    let hold = false;
    let release!: (value: typeof graded) => void;
    const snapshot = new Promise<typeof graded>((resolve) => {
      release = resolve;
    });

    rpc['learning.attempt'].mockImplementation(() =>
      hold ? Effect.promise(() => snapshot) : Effect.succeed(before)
    );
    rpc['learning.answerQuestion'].mockImplementation(() =>
      Effect.sync(() => {
        hold = true;

        return saved;
      })
    );
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?attempt=70', rpc);
    await user.type(await screen.findByRole('textbox', { name: en.YourAnswer }), 'They are even.');
    await user.click(screen.getByRole('button', { name: en.SubmitAnswer }));

    try {
      expect(
        await screen.findByText(en.PracticeUngraded, { selector: '[role=status]', exact: true })
      ).toBeInTheDocument();
    } finally {
      release(graded);
    }

    expect(await screen.findByText('Live grading corrected the answer.')).toBeInTheDocument();
    expect(
      screen.getByText(en.VerdictIncorrect, { selector: '[role=status]', exact: true })
    ).toBeInTheDocument();
  }
);

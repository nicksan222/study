import { test } from '@study/testing';

import { FlashcardReviewView } from './flashcard-review-view';
import { PracticePresentationProvider } from './practice-presentation';
import type { PracticePresentation } from './practice-presentation';
import type { PracticeResultsModel } from './practice-question-model';
import { QuizResultsView } from './quiz-results-view';

const presentation: PracticePresentation = {
  t: (key) => key,
  questionNumber: String,
  questionCount: String,
  reviewProgress: (a, b) => `${a}/${b}`,
  percentage: (value) => `${value * 100}%`
};

test.unit.stable(
  'the shared card reveals, rates, blocks pending shortcuts and restarts completion',
  ({ vi, render, expect, screen, fireEvent }) => {
    const reveal = vi.fn();
    const rate = vi.fn();
    const restart = vi.fn();
    const view = (revealed: boolean, pending: boolean, complete = false) => (
      <PracticePresentationProvider value={presentation}>
        <FlashcardReviewView
          card={complete ? undefined : { key: 'card', front: 'Question', back: 'Answer' }}
          revealed={revealed}
          pending={pending}
          completed={complete ? 1 : 0}
          total={1}
          reveal={reveal}
          rate={rate}
          restart={restart}
        />
      </PracticePresentationProvider>
    );
    const mounted = render(view(false, false));

    expect(screen.queryByText('Answer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ShowAnswer/ }));
    expect(reveal).toHaveBeenCalledOnce();
    mounted.rerender(view(true, false));
    expect(screen.getByText('Answer')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /RateGood/ }));
    expect(rate).toHaveBeenCalledWith('good');
    mounted.rerender(view(true, true));
    expect(screen.getByRole('button', { name: /RateGood/ })).toBeDisabled();
    fireEvent.keyDown(screen.getByText('Question').closest('[tabindex]')!, { key: '1' });
    expect(rate).toHaveBeenCalledTimes(1);
    mounted.rerender(view(false, false, true));
    fireEvent.click(screen.getByRole('button', { name: /PracticeReviewAgain/ }));
    expect(restart).toHaveBeenCalledOnce();
  }
);

test.unit.stable(
  'the shared results navigate stored answers and preserve pending grading',
  ({ render, expect, screen, fireEvent }) => {
    render(
      <PracticePresentationProvider value={presentation}>
        <QuizResultsView
          attempt={{
            scoring: { complete: false, score: null },
            questions: [
              {
                id: 1n,
                kind: 'open',
                prompt: 'First',
                answer: { type: 'open', answer: 'Learner' },
                referenceAnswer: 'Reference',
                explanation: 'Why',
                feedback: null,
                score: null
              },
              {
                id: 2n,
                kind: 'fill_blank',
                prompt: 'Second',
                answer: null,
                referenceAnswer: 'Word',
                explanation: 'Why again',
                feedback: null,
                score: null
              }
            ]
          }}
        />
      </PracticePresentationProvider>
    );
    expect(screen.getByText('PracticeScorePending')).toBeVisible();
    expect(screen.getByText('Learner')).toBeVisible();
    expect(screen.getByRole('button', { name: 'QuizPrevious' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'PracticeNextQuestion' }));
    expect(screen.getByText('Second')).toBeVisible();
    expect(screen.getByRole('button', { name: 'PracticeNextQuestion' })).toBeDisabled();
  }
);

test.unit.stable(
  'separate result views preserve their selected answer for the same question',
  ({ render, screen, expect }) => {
    const attempt: PracticeResultsModel = {
      scoring: { complete: true, score: 1 },
      questions: [
        {
          id: 1n,
          kind: 'single_choice',
          prompt: 'Question',
          choices: [
            { id: 1n, text: 'Selected', isCorrect: true },
            { id: 2n, text: 'Alternative', isCorrect: false }
          ],
          answer: { type: 'choice', choiceIds: [1n] },
          explanation: 'Explanation',
          feedback: null,
          score: 1
        }
      ]
    };

    render(
      <PracticePresentationProvider value={presentation}>
        <QuizResultsView attempt={attempt} />
        <QuizResultsView attempt={attempt} />
      </PracticePresentationProvider>
    );
    const selected = screen.getAllByRole('radio', { name: /Selected/ });

    expect(selected).toHaveLength(2);
    expect(selected[0]).not.toHaveAttribute('name', selected[1]!.getAttribute('name'));

    for (const answer of selected) expect(answer).toBeChecked();
  }
);

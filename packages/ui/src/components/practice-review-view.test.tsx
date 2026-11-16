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

test.stable(
  'the shared card reveals, rates, blocks pending shortcuts and restarts completion',
  () => {
    const reveal = test.vi.fn();
    const rate = test.vi.fn();
    const restart = test.vi.fn();
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
    const mounted = test.render(view(false, false));

    test.expect(test.screen.queryByText('Answer')).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: /ShowAnswer/ }));
    test.expect(reveal).toHaveBeenCalledOnce();
    mounted.rerender(view(true, false));
    test.expect(test.screen.getByText('Answer')).toBeVisible();
    test.fireEvent.click(test.screen.getByRole('button', { name: /RateGood/ }));
    test.expect(rate).toHaveBeenCalledWith('good');
    mounted.rerender(view(true, true));
    test.expect(test.screen.getByRole('button', { name: /RateGood/ })).toBeDisabled();
    test.fireEvent.keyDown(test.screen.getByText('Question').closest('[tabindex]')!, { key: '1' });
    test.expect(rate).toHaveBeenCalledTimes(1);
    mounted.rerender(view(false, false, true));
    test.fireEvent.click(test.screen.getByRole('button', { name: /PracticeReviewAgain/ }));
    test.expect(restart).toHaveBeenCalledOnce();
  }
);

test.stable('the shared results navigate stored answers and preserve pending grading', () => {
  test.render(
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
  test.expect(test.screen.getByText('PracticeScorePending')).toBeVisible();
  test.expect(test.screen.getByText('Learner')).toBeVisible();
  test.expect(test.screen.getByRole('button', { name: 'QuizPrevious' })).toBeDisabled();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'PracticeNextQuestion' }));
  test.expect(test.screen.getByText('Second')).toBeVisible();
  test.expect(test.screen.getByRole('button', { name: 'PracticeNextQuestion' })).toBeDisabled();
});

test.stable('separate result views preserve their selected answer for the same question', () => {
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

  test.render(
    <PracticePresentationProvider value={presentation}>
      <QuizResultsView attempt={attempt} />
      <QuizResultsView attempt={attempt} />
    </PracticePresentationProvider>
  );
  const selected = test.screen.getAllByRole('radio', { name: /Selected/ });

  test.expect(selected).toHaveLength(2);
  test.expect(selected[0]).not.toHaveAttribute('name', selected[1]!.getAttribute('name'));

  for (const answer of selected) test.expect(answer).toBeChecked();
});

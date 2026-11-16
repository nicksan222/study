import { test } from '@study/testing';

import { PracticePresentationProvider } from './practice-presentation';
import { QuizQuestionView } from './quiz-question-view';

test.stable(
  'the shared multiple choice editor retains selections and submits a complete response',
  () => {
    const submit = test.vi.fn();

    test.render(
      <PracticePresentationProvider
        value={{
          t: (key) => key,
          questionNumber: String,
          questionCount: String,
          reviewProgress: (a, b) => `${a}/${b}`,
          percentage: String
        }}
      >
        <QuizQuestionView
          question={{
            id: 1n,
            kind: 'multiple_choice',
            prompt: 'Primes',
            answer: null,
            choices: [
              { id: 2n, text: 'Two' },
              { id: 3n, text: 'Three' }
            ]
          }}
          pending={false}
          submit={submit}
          last
        />
      </PracticePresentationProvider>
    );
    test.expect(test.screen.getByRole('button', { name: 'SubmitAnswer' })).toBeDisabled();
    test.fireEvent.click(test.screen.getByRole('checkbox', { name: /Two/ }));
    test.fireEvent.click(test.screen.getByRole('checkbox', { name: /Three/ }));
    test.fireEvent.click(test.screen.getByRole('button', { name: 'SubmitAnswer' }));
    test.expect(submit).toHaveBeenCalledWith({ type: 'choice', choiceIds: [2n, 3n] });
  }
);

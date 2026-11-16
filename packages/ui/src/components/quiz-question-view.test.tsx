import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { PracticePresentationProvider } from './practice-presentation';
import { QuizQuestionView } from './quiz-question-view';

testStable(
  'the shared multiple choice editor retains selections and submits a complete response',
  () => {
    const submit = vi.fn();

    render(
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
    expect(screen.getByRole('button', { name: 'SubmitAnswer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Two/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Three/ }));
    fireEvent.click(screen.getByRole('button', { name: 'SubmitAnswer' }));
    expect(submit).toHaveBeenCalledWith({ type: 'choice', choiceIds: [2n, 3n] });
  }
);

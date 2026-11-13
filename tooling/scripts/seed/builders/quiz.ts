import type { materialQuestionInputSchema } from '@study/contracts/materials/schemas';

type Question = typeof materialQuestionInputSchema.Type;

export function choice(
  prompt: string,
  correct: string,
  wrong: string,
  explanation: string
): Question {
  return {
    kind: 'single_choice',
    prompt,
    explanation,
    choices: [
      { text: correct, isCorrect: true },
      { text: wrong, isCorrect: false }
    ]
  };
}

export function multipleChoice(
  prompt: string,
  correct: readonly string[],
  wrong: readonly string[],
  explanation: string
): Question {
  return {
    kind: 'multiple_choice',
    prompt,
    explanation,
    choices: [
      ...correct.map((text) => ({ text, isCorrect: true })),
      ...wrong.map((text) => ({ text, isCorrect: false }))
    ]
  };
}

export function openQuestion(
  prompt: string,
  referenceAnswer: string,
  explanation: string
): Question {
  return { kind: 'open', prompt, referenceAnswer, explanation };
}

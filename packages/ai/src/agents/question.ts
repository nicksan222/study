import type { z } from 'zod';

import type { createChoiceQuestionAgent, choiceQuestionSchema } from './choice-question.ts';
import type { createOpenQuestionAgent, openQuestionSchema } from './open-question.ts';

export type Question =
  | ({ type: 'choice' } & z.infer<typeof choiceQuestionSchema>)
  | ({ type: 'open' } & z.infer<typeof openQuestionSchema>);

export async function generateQuestion(
  agents: {
    choiceQuestion: ReturnType<typeof createChoiceQuestionAgent>;
    openQuestion: ReturnType<typeof createOpenQuestionAgent>;
  },
  kind: 'choice' | 'open',
  prompt: string,
  signal?: AbortSignal
): Promise<Question> {
  if (kind === 'open')
    return {
      type: 'open',
      ...(await agents.openQuestion.generate({ prompt, abortSignal: signal })).output
    };

  const value = (await agents.choiceQuestion.generate({ prompt, abortSignal: signal })).output;

  if (
    value.choices.length < 3 ||
    value.choices.length > 5 ||
    value.answer < 0 ||
    value.answer >= value.choices.length ||
    !value.choices.every((choice) => choice.trim()) ||
    !value.question.trim() ||
    !value.gist.trim() ||
    !value.explanation.trim()
  )
    throw new Error('Invalid multiple-choice question');

  return { type: 'choice', ...value };
}

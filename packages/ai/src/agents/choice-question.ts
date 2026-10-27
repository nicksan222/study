import { Output, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import type { AgentContext } from './shared.ts';

export const choiceQuestionSchema = z.object({
  gist: z.string(),
  question: z.string(),
  choices: z.array(z.string()),
  answer: z.number().int(),
  explanation: z.string(),
  cites: z.array(z.number().int())
});

export function createChoiceQuestionAgent({ settings, instructions, tools }: AgentContext) {
  return new ToolLoopAgent({
    ...settings,
    id: 'choice-question',
    instructions: `${instructions} Write one multiple-choice question with three to five choices, one correct answer index, and citations.`,
    tools,
    output: Output.object({ schema: choiceQuestionSchema })
  });
}

import { Output, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import type { AgentContext } from './shared.ts';

export const openQuestionSchema = z.object({
  gist: z.string(),
  question: z.string(),
  reference: z.string(),
  cites: z.array(z.number().int())
});

export function createOpenQuestionAgent({ settings, instructions, tools }: AgentContext) {
  return new ToolLoopAgent({
    ...settings,
    id: 'open-question',
    instructions: `${instructions} Write one open question, a reference answer, and citations.`,
    tools,
    output: Output.object({ schema: openQuestionSchema })
  });
}

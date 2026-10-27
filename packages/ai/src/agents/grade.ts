import { Output, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import type { AgentContext } from './shared.ts';

export const gradeSchema = z.object({
  verdict: z.enum(['correct', 'partly', 'incorrect']),
  feedback: z.string()
});

export function createGradeAgent({ settings, instructions, tools }: AgentContext) {
  return new ToolLoopAgent({
    ...settings,
    id: 'grade',
    instructions: `${instructions} Grade the answer by meaning against the question and reference. Give kind, concise feedback.`,
    tools,
    output: Output.object({ schema: gradeSchema })
  });
}

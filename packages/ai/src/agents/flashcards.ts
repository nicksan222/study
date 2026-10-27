import { Output, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import type { AgentContext } from './shared.ts';

export const flashcardsSchema = z.object({
  cards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      cites: z.array(z.number().int())
    })
  )
});

export function createFlashcardsAgent({ settings, instructions, tools }: AgentContext) {
  return new ToolLoopAgent({
    ...settings,
    id: 'flashcards',
    instructions: `${instructions} Produce grounded flashcards and cite numbered passages.`,
    tools,
    output: Output.object({ schema: flashcardsSchema })
  });
}

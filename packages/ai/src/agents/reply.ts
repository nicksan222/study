import { ToolLoopAgent } from 'ai';

import type { AgentContext } from './shared.ts';

export function createReplyAgent({ settings, instructions, tools }: AgentContext) {
  return new ToolLoopAgent({
    ...settings,
    id: 'reply',
    instructions: `${instructions} Answer clearly using relevant sources and cite them; say when the sources do not cover the question.`,
    tools
  });
}

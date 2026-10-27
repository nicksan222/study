import { ToolLoopAgent } from 'ai';

import type { AgentContext } from './shared.ts';

export function createRewriteAgent({ settings, instructions, tools }: AgentContext) {
  return new ToolLoopAgent({
    ...settings,
    id: 'rewrite',
    instructions: `${instructions} Rewrite the given text as requested, retaining its language and adding no unsupported facts.`,
    tools
  });
}

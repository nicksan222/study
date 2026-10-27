import { ToolLoopAgent } from 'ai';

import type { AgentContext } from './shared.ts';

export function createTitleAgent({ settings, instructions }: AgentContext) {
  return new ToolLoopAgent({
    ...settings,
    id: 'title',
    instructions: `${instructions} Name the study session in two to six words, without quotes or punctuation.`
  });
}

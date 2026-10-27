import { Output, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import type { AgentContext } from './shared.ts';

export const diagramSchema = z.object({ mermaid: z.string() });

export function createDiagramAgent({ settings, instructions, tools }: AgentContext) {
  return new ToolLoopAgent({
    ...settings,
    id: 'diagram',
    instructions: `${instructions} Produce a grounded diagram and cite numbered passages. Draw a Mermaid flowchart starting with flowchart TD or LR. Use short, quoted node labels with citations [n], <br> for line breaks, and labelled arrows. Keep it readable with 6 to 25 nodes. Do not use styles, classes or click handlers.`,
    tools,
    output: Output.object({ schema: diagramSchema })
  });
}

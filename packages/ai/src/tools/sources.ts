import { tool } from 'ai';
import { z } from 'zod';

export interface Source {
  id: string;
  name: string;
  text: string;
}

export interface AgentCapabilities {
  searchSources(query: string, signal?: AbortSignal): Promise<Source[]>;
}

export function createSourcesTool(capabilities: AgentCapabilities) {
  return tool({
    description: 'Find passages in the student study material.',
    inputSchema: z.object({ query: z.string().min(1) }),
    execute: ({ query }, { abortSignal }) => capabilities.searchSources(query, abortSignal)
  });
}

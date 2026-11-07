import { AgentRule } from '@study/contracts/settings/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import type { AgentRules } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, vi } from 'vite-plus/test';

import { agentRulesOptions } from '#web/lib/study-client/agent-rules.queries.ts';

import { useAgentRules } from './use-agent-rules';

const api = vi.hoisted(() => ({
  read: vi.fn<() => Promise<AgentRules>>(),
  save: vi.fn<(rules: AgentRules) => Promise<object>>()
}));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (
    invoke: (rpc: {
      'settings.agentRules': typeof api.read;
      'settings.saveAgentRules': typeof api.save;
    }) => unknown
  ) => invoke({ 'settings.agentRules': api.read, 'settings.saveAgentRules': api.save })
}));

testStable(
  'retains local drafts while incorporating refreshed preferences from another window',
  async () => {
    api.read.mockResolvedValue(defaultAgentRules);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, unmount } = renderHook(useAgentRules, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    });

    try {
      await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
      act(() => result.current.update('Keep examples.'));
      act(() =>
        client.setQueryData(agentRulesOptions().queryKey, {
          ...defaultAgentRules,
          titles: 'Use short titles.'
        })
      );
      await waitFor(() =>
        expect(result.current.rules).toEqual({
          ...defaultAgentRules,
          documents: 'Keep examples.',
          titles: 'Use short titles.'
        })
      );
      act(() => result.current.select('unsupported-category'));
      expect(result.current.selected).toBe(AgentRule.Documents);
      expect(result.current.changed).toBe(true);
    } finally {
      unmount();
      client.clear();
    }
  }
);

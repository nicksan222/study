import { AgentRule, defaultAgentRules } from '@study/contracts';
import type { AgentRules } from '@study/contracts';
import { test } from '@study/testing';

import { useAgentRules } from './use-agent-rules';

function createApi(mock: test.Mock) {
  return {
    read: mock.fn<() => Promise<AgentRules>>(),
    save: mock.fn<(rules: AgentRules) => Promise<object>>()
  };
}

let api: ReturnType<typeof createApi>;

test.beforeEach(({ mock }) => {
  api = createApi(mock);
});

test.stable(
  'retains local drafts while incorporating refreshed preferences from another window',
  async ({ rpcTestTransport, renderHook, waitFor, expect, act }) => {
    api.read.mockResolvedValue(defaultAgentRules);
    const fixture = rpcTestTransport(async (tag) => {
      if (tag === 'settings.agentRules') return api.read();

      throw new Error(tag);
    });
    const { result, unmount } = renderHook(useAgentRules, { wrapper: fixture.wrapper });

    try {
      await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
      act(() => result.current.update('Keep examples.'));
      api.read.mockResolvedValue({ ...defaultAgentRules, titles: 'Use short titles.' });
      await act(async () => {
        await fixture.notify();
      });
      await waitFor(() =>
        expect(result.current.rules).toEqual({
          ...defaultAgentRules,
          pages: 'Keep examples.',
          titles: 'Use short titles.'
        })
      );
      act(() => result.current.select('unsupported-category'));
      expect(result.current.selected).toBe(AgentRule.Pages);
      expect(result.current.changed).toBe(true);
    } finally {
      unmount();
    }
  }
);

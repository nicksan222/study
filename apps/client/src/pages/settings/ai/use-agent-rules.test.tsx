import { AgentRule, defaultAgentRules } from '@study/contracts';
import type { AgentRules } from '@study/contracts';
import { test } from '@study/testing';

import { useAgentRules } from './use-agent-rules';

const api = test.hoisted(() => ({
  read: test.vi.fn<() => Promise<AgentRules>>(),
  save: test.vi.fn<(rules: AgentRules) => Promise<object>>()
}));

test.stable(
  'retains local drafts while incorporating refreshed preferences from another window',
  async () => {
    api.read.mockResolvedValue(defaultAgentRules);
    const fixture = test.rpcTestTransport(async (tag) => {
      if (tag === 'settings.agentRules') return api.read();

      throw new Error(tag);
    });
    const { result, unmount } = test.renderHook(useAgentRules, { wrapper: fixture.wrapper });

    try {
      await test.waitFor(() => test.expect(result.current.query.isSuccess).toBe(true));
      test.act(() => result.current.update('Keep examples.'));
      api.read.mockResolvedValue({ ...defaultAgentRules, titles: 'Use short titles.' });
      await test.act(async () => {
        await fixture.notify();
      });
      await test.waitFor(() =>
        test.expect(result.current.rules).toEqual({
          ...defaultAgentRules,
          pages: 'Keep examples.',
          titles: 'Use short titles.'
        })
      );
      test.act(() => result.current.select('unsupported-category'));
      test.expect(result.current.selected).toBe(AgentRule.Pages);
      test.expect(result.current.changed).toBe(true);
    } finally {
      unmount();
    }
  }
);

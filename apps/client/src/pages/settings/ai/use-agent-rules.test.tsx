import { AgentRule } from '@study/contracts/settings/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import type { AgentRules } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { rpcTestTransport as settingsTransport } from '#client/test/rpc.tsx';

import { useAgentRules } from './use-agent-rules';

const api = vi.hoisted(() => ({
  read: vi.fn<() => Promise<AgentRules>>(),
  save: vi.fn<(rules: AgentRules) => Promise<object>>()
}));

testStable(
  'retains local drafts while incorporating refreshed preferences from another window',
  async () => {
    api.read.mockResolvedValue(defaultAgentRules);
    const fixture = settingsTransport(async (tag) => {
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

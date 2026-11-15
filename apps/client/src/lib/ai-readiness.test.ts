import { testStable } from '@study/testing/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { aiReadiness, useAiReadiness } from './ai-readiness';

const settings = vi.hoisted(() => ({ load: vi.fn() }));

const data = {
  status: { signedIn: false, email: null, sharing: false },
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: ['model'],
      defaults: { tiny: 'model', medium: 'model', smart: 'model' },
      configured: true
    }
  ],
  settings: {
    tiny: { provider: 1 as const },
    medium: { provider: 'anthropic' },
    smart: { provider: 1 as const }
  }
};

describe('AI readiness', () => {
  testStable('checks the configured provider for each tier', () => {
    expect(aiReadiness(data, 'tiny')).toBe(false);
    expect(aiReadiness(data, 'medium')).toBe(true);
    expect(aiReadiness({ ...data, status: { ...data.status, signedIn: true } }, 'smart')).toBe(
      false
    );
    expect(
      aiReadiness({ ...data, status: { ...data.status, signedIn: true, sharing: true } }, 'smart')
    ).toBe(true);
    expect(aiReadiness({ ...data, providers: [] }, 'medium')).toBe(false);
    expect(
      aiReadiness({ ...data, providers: [{ ...data.providers[0]!, configured: false }] }, 'medium')
    ).toBe(false);
  });
});

testStable(
  'readiness distinguishes loading and failure and refreshes after configuration changes',
  async () => {
    let finish: (value: typeof data) => void = () => {};

    settings.load.mockReturnValue(
      new Promise<typeof data>((resolve) => {
        finish = resolve;
      })
    );
    const client = rpcTestTransport(async (tag) => {
      const snapshot = await settings.load();

      if (tag === 'auth.status') return snapshot.status;

      if (tag === 'auth.providers') return snapshot.providers;

      if (tag === 'settings.llmSettings') return snapshot.settings;

      throw new Error(tag);
    });
    const hook = renderHook(() => useAiReadiness('tiny'), { wrapper: client.wrapper });

    try {
      expect(hook.result.current).toBe('checking');
      await act(async () => {
        finish(data);
      });
      await waitFor(() => expect(hook.result.current).toBe('setup'));
      settings.load.mockResolvedValue({
        ...data,
        status: { ...data.status, signedIn: true, sharing: true }
      });
      await act(async () => {
        await client.notify();
      });
      await waitFor(() => expect(hook.result.current).toBe('ready'));
      settings.load.mockRejectedValue(new Error('Unavailable'));
      await act(async () => {
        await client.notify();
      });
      await waitFor(() => expect(hook.result.current).toBe('unavailable'));
    } finally {
      hook.unmount();
    }
  }
);

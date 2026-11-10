import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, vi } from 'vite-plus/test';

import { aiReadiness, useAiReadiness } from './ai-readiness';

const settings = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('./study-client/ai-settings', () => ({ loadAiSettings: settings.load }));

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
      true
    );
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useAiReadiness('tiny'), { wrapper });

    try {
      expect(hook.result.current).toBe('checking');
      await act(async () => {
        finish(data);
      });
      await waitFor(() => expect(hook.result.current).toBe('setup'));
      settings.load.mockResolvedValue({ ...data, status: { ...data.status, signedIn: true } });
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['ai-settings'] });
      });
      await waitFor(() => expect(hook.result.current).toBe('ready'));
      settings.load.mockRejectedValue(new Error('Unavailable'));
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['ai-settings'] });
      });
      await waitFor(() => expect(hook.result.current).toBe('unavailable'));
    } finally {
      hook.unmount();
      client.clear();
    }
  }
);

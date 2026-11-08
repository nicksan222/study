import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, vi } from 'vite-plus/test';

import * as operations from '#web/lib/study-client/ai-settings.ts';

import { useProviderSettings } from './use-provider-settings';

vi.mock('#web/lib/study-client/ai-settings.ts', () => ({
  saveAiSettings: vi.fn().mockResolvedValue({}),
  saveProviderApiKey: vi.fn().mockResolvedValue(undefined)
}));

const data = {
  settings: {
    tiny: { provider: 1 as const },
    medium: { provider: 'anthropic', model: 'old-model' },
    smart: { provider: 1 as const }
  },
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      configured: false,
      models: ['new-model'],
      defaults: { tiny: 'new-model', medium: 'new-model', smart: 'new-model' }
    }
  ],
  status: { signedIn: false, email: null, sharing: false }
};

function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const refresh = vi.fn().mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return { client, refresh, ...renderHook(() => useProviderSettings(data, refresh), { wrapper }) };
}

testStable(
  'a combined selection saves its provider and model together and preserves other tiers',
  async () => {
    const { result } = mount();

    act(() => result.current.setSetup('tiny', { provider: 'anthropic', model: 'new-model' }));
    await waitFor(() =>
      expect(operations.saveAiSettings).toHaveBeenCalledWith({
        ...data.settings,
        tiny: { provider: 'anthropic', model: 'new-model' }
      })
    );
    expect(operations.saveAiSettings).toHaveBeenCalledTimes(1);
    act(() => result.current.setSetup('medium', { provider: 1 }));
    await waitFor(() =>
      expect(operations.saveAiSettings).toHaveBeenCalledWith({
        ...data.settings,
        medium: { provider: 1 }
      })
    );
  }
);

testStable('credential mutation variables are discarded after saving and refresh', async () => {
  const { result, client, refresh } = mount();

  await act(async () => {
    await result.current.saveApiKey('anthropic', 'temporary-secret');
  });
  expect(vi.mocked(operations.saveProviderApiKey).mock.calls[0]?.[0]).toStrictEqual({
    provider: 'anthropic',
    apiKey: 'temporary-secret'
  });
  expect(refresh).toHaveBeenCalledOnce();
  await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
});

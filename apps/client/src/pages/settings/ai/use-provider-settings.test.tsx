import { llmSettingsSchema, apiKeyInputSchema } from '@study/contracts/settings/schemas';
import { testStable } from '@study/testing/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { rpcTestTransport as settingsTransport } from '#client/test/rpc.tsx';

import { useProviderSettings } from './use-provider-settings';

const operations = vi.hoisted(() => ({
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
  const fixture = settingsTransport(async (tag, input) => {
    if (tag === 'settings.saveLlmSettings')
      return operations.saveAiSettings(Schema.decodeUnknownSync(llmSettingsSchema)(input));

    if (tag === 'auth.saveApiKey')
      return operations.saveProviderApiKey(Schema.decodeUnknownSync(apiKeyInputSchema)(input));

    throw new Error(tag);
  });

  return renderHook(() => useProviderSettings(data), { wrapper: fixture.wrapper });
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

testStable('submits write-only credentials once and clears mutation presentation', async () => {
  const { result } = mount();

  await act(async () => {
    await result.current.saveApiKey('anthropic', 'temporary-secret');
  });
  expect(operations.saveProviderApiKey).toHaveBeenCalledWith({
    provider: 'anthropic',
    apiKey: 'temporary-secret'
  });
  expect(result.current.pending).toBe(false);
  expect(result.current.error).toBe(false);
});

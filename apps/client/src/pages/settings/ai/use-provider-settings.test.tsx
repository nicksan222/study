import { llmSettingsSchema, apiKeyInputSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { useProviderSettings } from './use-provider-settings';

const operations = test.hoisted(() => ({
  saveAiSettings: test.vi.fn().mockResolvedValue({}),
  saveProviderApiKey: test.vi.fn().mockResolvedValue(undefined)
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
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.saveLlmSettings')
      return operations.saveAiSettings(Schema.decodeUnknownSync(llmSettingsSchema)(input));

    if (tag === 'auth.saveApiKey')
      return operations.saveProviderApiKey(Schema.decodeUnknownSync(apiKeyInputSchema)(input));

    throw new Error(tag);
  });

  return test.renderHook(() => useProviderSettings(data), { wrapper: fixture.wrapper });
}

test.stable(
  'a combined selection saves its provider and model together and preserves other tiers',
  async () => {
    const { result } = mount();

    test.act(() => result.current.setSetup('tiny', { provider: 'anthropic', model: 'new-model' }));
    await test.waitFor(() =>
      test.expect(operations.saveAiSettings).toHaveBeenCalledWith({
        ...data.settings,
        tiny: { provider: 'anthropic', model: 'new-model' }
      })
    );
    test.expect(operations.saveAiSettings).toHaveBeenCalledTimes(1);
    test.act(() => result.current.setSetup('medium', { provider: 1 }));
    await test.waitFor(() =>
      test.expect(operations.saveAiSettings).toHaveBeenCalledWith({
        ...data.settings,
        medium: { provider: 1 }
      })
    );
  }
);

test.stable('submits write-only credentials once and clears mutation presentation', async () => {
  const { result } = mount();

  await test.act(async () => {
    await result.current.saveApiKey('anthropic', 'temporary-secret');
  });
  test.expect(operations.saveProviderApiKey).toHaveBeenCalledWith({
    provider: 'anthropic',
    apiKey: 'temporary-secret'
  });
  test.expect(result.current.pending).toBe(false);
  test.expect(result.current.error).toBe(false);
});

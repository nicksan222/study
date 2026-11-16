import { llmSettingsSchema, apiKeyInputSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { useProviderSettings } from './use-provider-settings';

function createOperations(mock: test.Mock) {
  return {
    saveAiSettings: mock.fn().mockResolvedValue({}),
    saveProviderApiKey: mock.fn().mockResolvedValue(undefined)
  };
}

let operations: ReturnType<typeof createOperations>;

test.beforeEach(({ mock }) => {
  operations = createOperations(mock);
});

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

function mount({
  rpcTestTransport,
  renderHook
}: Pick<test.Context, 'rpcTestTransport' | 'renderHook'>) {
  const fixture = rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.saveLlmSettings')
      return operations.saveAiSettings(Schema.decodeUnknownSync(llmSettingsSchema)(input));

    if (tag === 'auth.saveApiKey')
      return operations.saveProviderApiKey(Schema.decodeUnknownSync(apiKeyInputSchema)(input));

    throw new Error(tag);
  });

  return renderHook(() => useProviderSettings(data), { wrapper: fixture.wrapper });
}

test.stable(
  'a combined selection saves its provider and model together and preserves other tiers',
  async ({ act, waitFor, expect, rpcTestTransport, renderHook }) => {
    const { result } = mount({ rpcTestTransport, renderHook });

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

test.stable(
  'submits write-only credentials once and clears mutation presentation',
  async ({ act, expect, rpcTestTransport, renderHook }) => {
    const { result } = mount({ rpcTestTransport, renderHook });

    await act(async () => {
      await result.current.saveApiKey('anthropic', 'temporary-secret');
    });
    expect(operations.saveProviderApiKey).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'temporary-secret'
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe(false);
  }
);

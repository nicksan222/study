import { test } from '@study/testing';

import { aiReadiness, useAiReadiness } from './ai-readiness';

function createMocks(mock: test.Mock) {
  return { load: mock.fn() };
}

let settings: ReturnType<typeof createMocks>;

test.unit.beforeEach(({ mock }) => {
  settings = createMocks(mock);
});

const data = {
  status: { signedIn: false, email: null, sharing: false },
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      configured: true
    }
  ],
  settings: {
    tiny: { provider: 1 as const },
    medium: { provider: 'anthropic', model: 'model' },
    smart: { provider: 1 as const }
  }
};

test.unit.describe('AI readiness', () => {
  test.unit.stable('requires ChatGPT account sharing for written exams', ({ expect }) => {
    const signedIn = { ...data, status: { ...data.status, signedIn: true, sharing: true } };

    expect(aiReadiness(data, 'medium', 'chatgpt')).toBe(false);
    expect(
      aiReadiness(
        { ...signedIn, status: { ...signedIn.status, sharing: false } },
        'medium',
        'chatgpt'
      )
    ).toBe(false);
    expect(aiReadiness(signedIn, 'medium', 'chatgpt')).toBe(true);
    expect(aiReadiness({ ...signedIn, providers: [] }, 'medium', 'configured-or-chatgpt')).toBe(
      true
    );
  });

  test.unit.stable('checks the configured provider for each tier', ({ expect }) => {
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

test.unit.stable(
  'ChatGPT remains ready when API-key providers are unavailable',
  async ({ rpcTestTransport, renderHook, expect, waitFor }) => {
    const { wrapper } = rpcTestTransport(async (tag) => {
      if (tag === 'auth.status') return { ...data.status, signedIn: true, sharing: true };

      if (tag === 'settings.llmSettings') return data.settings;

      throw new Error('Providers unavailable');
    });
    const hook = renderHook(
      () => ({
        exam: useAiReadiness('medium', 'chatgpt'),
        chooser: useAiReadiness('medium', 'configured-or-chatgpt'),
        quiz: useAiReadiness('medium')
      }),
      { wrapper }
    );

    await waitFor(() =>
      expect(hook.result.current).toEqual({ exam: 'ready', chooser: 'ready', quiz: 'unavailable' })
    );
    hook.unmount();
  }
);

test.unit.stable(
  'readiness distinguishes loading and failure and refreshes after configuration changes',
  async ({ rpcTestTransport, renderHook, expect, act, waitFor }) => {
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

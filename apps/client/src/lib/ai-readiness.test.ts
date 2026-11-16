import { test } from '@study/testing';

import { aiReadiness, useAiReadiness } from './ai-readiness';

const settings = test.hoisted(() => ({ load: test.vi.fn() }));

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

test.describe('AI readiness', () => {
  test.stable('checks the configured provider for each tier', () => {
    test.expect(aiReadiness(data, 'tiny')).toBe(false);
    test.expect(aiReadiness(data, 'medium')).toBe(true);
    test
      .expect(aiReadiness({ ...data, status: { ...data.status, signedIn: true } }, 'smart'))
      .toBe(false);
    test
      .expect(
        aiReadiness({ ...data, status: { ...data.status, signedIn: true, sharing: true } }, 'smart')
      )
      .toBe(true);
    test.expect(aiReadiness({ ...data, providers: [] }, 'medium')).toBe(false);
    test
      .expect(
        aiReadiness(
          { ...data, providers: [{ ...data.providers[0]!, configured: false }] },
          'medium'
        )
      )
      .toBe(false);
  });
});

test.stable(
  'readiness distinguishes loading and failure and refreshes after configuration changes',
  async () => {
    let finish: (value: typeof data) => void = () => {};

    settings.load.mockReturnValue(
      new Promise<typeof data>((resolve) => {
        finish = resolve;
      })
    );
    const client = test.rpcTestTransport(async (tag) => {
      const snapshot = await settings.load();

      if (tag === 'auth.status') return snapshot.status;

      if (tag === 'auth.providers') return snapshot.providers;

      if (tag === 'settings.llmSettings') return snapshot.settings;

      throw new Error(tag);
    });
    const hook = test.renderHook(() => useAiReadiness('tiny'), { wrapper: client.wrapper });

    try {
      test.expect(hook.result.current).toBe('checking');
      await test.act(async () => {
        finish(data);
      });
      await test.waitFor(() => test.expect(hook.result.current).toBe('setup'));
      settings.load.mockResolvedValue({
        ...data,
        status: { ...data.status, signedIn: true, sharing: true }
      });
      await test.act(async () => {
        await client.notify();
      });
      await test.waitFor(() => test.expect(hook.result.current).toBe('ready'));
      settings.load.mockRejectedValue(new Error('Unavailable'));
      await test.act(async () => {
        await client.notify();
      });
      await test.waitFor(() => test.expect(hook.result.current).toBe('unavailable'));
    } finally {
      hook.unmount();
    }
  }
);

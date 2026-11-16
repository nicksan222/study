import { test } from '@study/testing';

import { LanguageProvider } from '#client/lib/i18n.tsx';

const request = test.vi.fn();

import { UsageSettings } from './index';

const totals = {
  input: 100,
  cacheRead: 80,
  cacheWrite: 0,
  output: 10,
  reasoning: 3,
  requests: 1,
  runs: 1,
  incomplete: 0
};

test.stable(
  'shows reported totals, switches breakdowns and refreshes the selected time range',
  async () => {
    const call = test.vi.mocked(request).mockResolvedValue({
      generatedAt: Date.now(),
      totals,
      providers: ['chatgpt'],
      models: [{ key: 'test-model', provider: 'chatgpt', ...totals }],
      agents: [{ key: 'reply', provider: 'chatgpt', ...totals }],
      days: []
    });
    const client = test.rpcTestTransport((tag, input) => request(tag, input));
    const user = test.userEvent.setup();
    const { unmount } = test.render(
      <client.wrapper>
        <LanguageProvider locale="english">
          <UsageSettings />
        </LanguageProvider>
      </client.wrapper>
    );

    try {
      test.expect(await test.screen.findByText('test-model')).toBeInTheDocument();
      test.expect(test.screen.getByRole('cell', { name: '110' })).toBeInTheDocument();
      await user.click(test.screen.getByRole('button', { name: 'Agent / task' }));
      test.expect(test.screen.getByText('reply')).toBeInTheDocument();
      await user.click(test.screen.getByRole('button', { name: '7 days' }));
      await test.waitFor(() =>
        test.expect(call).toHaveBeenCalledWith('settings.usage', { days: 7 })
      );
      const before = call.mock.calls.length;

      await user.click(test.screen.getByRole('button', { name: 'Refresh usage' }));
      await test.waitFor(() => test.expect(call.mock.calls.length).toBeGreaterThan(before));
    } finally {
      unmount();
    }
  }
);

test.stable('explains empty history in Italian without presenting invented usage', async () => {
  test.vi.mocked(request).mockResolvedValue({
    generatedAt: Date.now(),
    totals: { ...totals, requests: 0 },
    providers: [],
    models: [],
    agents: [],
    days: []
  });
  const client = test.rpcTestTransport((tag, input) => request(tag, input));
  const { unmount } = test.render(
    <client.wrapper>
      <LanguageProvider locale="italian">
        <UsageSettings />
      </LanguageProvider>
    </client.wrapper>
  );

  try {
    test.expect(await test.screen.findByText(/Nessun utilizzo registrato/)).toBeInTheDocument();
    test.expect(test.screen.queryByRole('table')).not.toBeInTheDocument();
  } finally {
    unmount();
  }
});

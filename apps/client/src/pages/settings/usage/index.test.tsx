import { test } from '@study/testing';

import { LanguageProvider } from '#client/lib/i18n.tsx';

import { UsageSettings } from './index';

function createRequest({ vi }: Pick<test.unit.Context, 'vi'>) {
  return vi.fn();
}

let request: ReturnType<typeof createRequest>;

test.unit.beforeEach(({ vi }) => {
  request = createRequest({ vi });
});

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

test.unit.stable(
  'shows reported totals, switches breakdowns and refreshes the selected time range',
  async ({ vi, rpcTestTransport, userEvent, render, expect, screen, waitFor }) => {
    const call = vi.mocked(request).mockResolvedValue({
      generatedAt: Date.now(),
      totals,
      providers: ['chatgpt'],
      models: [{ key: 'test-model', provider: 'chatgpt', ...totals }],
      agents: [{ key: 'reply', provider: 'chatgpt', ...totals }],
      days: []
    });
    const client = rpcTestTransport((tag, input) => request(tag, input));
    const user = userEvent.setup();
    const { unmount } = render(
      <client.wrapper>
        <LanguageProvider locale="english">
          <UsageSettings />
        </LanguageProvider>
      </client.wrapper>
    );

    try {
      expect(await screen.findByText('test-model')).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: '110' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Agent / task' }));
      expect(screen.getByText('reply')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '7 days' }));
      await waitFor(() => expect(call).toHaveBeenCalledWith('settings.usage', { days: 7 }));
      const before = call.mock.calls.length;

      await user.click(screen.getByRole('button', { name: 'Refresh usage' }));
      await waitFor(() => expect(call.mock.calls.length).toBeGreaterThan(before));
    } finally {
      unmount();
    }
  }
);

test.unit.stable(
  'keeps the dashboard visible for empty history in Italian without inventing usage',
  async ({ vi, rpcTestTransport, render, expect, screen }) => {
    vi.mocked(request).mockResolvedValue({
      generatedAt: Date.now(),
      totals: {
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        reasoning: 0,
        requests: 0,
        runs: 0,
        incomplete: 0
      },
      providers: [],
      models: [],
      agents: [],
      days: []
    });
    const client = rpcTestTransport((tag, input) => request(tag, input));
    const { unmount } = render(
      <client.wrapper>
        <LanguageProvider locale="italian">
          <UsageSettings />
        </LanguageProvider>
      </client.wrapper>
    );

    try {
      expect(await screen.findByText(/Nessun utilizzo registrato/)).toBeInTheDocument();
      expect(
        screen.getByRole('img', { name: 'Token elaborati al giorno · UTC' })
      ).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('0 richieste · 0 esecuzioni agente')).toBeInTheDocument();
    } finally {
      unmount();
    }
  }
);

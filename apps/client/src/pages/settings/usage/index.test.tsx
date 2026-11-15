import { testStable } from '@study/testing/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { LanguageProvider } from '#client/lib/i18n.tsx';
import { rpcTestTransport as settingsTransport } from '#client/test/rpc.tsx';

const request = vi.fn();

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

testStable(
  'shows reported totals, switches breakdowns and refreshes the selected time range',
  async () => {
    const call = vi.mocked(request).mockResolvedValue({
      generatedAt: Date.now(),
      totals,
      providers: ['chatgpt'],
      models: [{ key: 'test-model', provider: 'chatgpt', ...totals }],
      agents: [{ key: 'reply', provider: 'chatgpt', ...totals }],
      days: []
    });
    const client = settingsTransport((tag, input) => request(tag, input));
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

testStable('explains empty history in Italian without presenting invented usage', async () => {
  vi.mocked(request).mockResolvedValue({
    generatedAt: Date.now(),
    totals: { ...totals, requests: 0 },
    providers: [],
    models: [],
    agents: [],
    days: []
  });
  const client = settingsTransport((tag, input) => request(tag, input));
  const { unmount } = render(
    <client.wrapper>
      <LanguageProvider locale="italian">
        <UsageSettings />
      </LanguageProvider>
    </client.wrapper>
  );

  try {
    expect(await screen.findByText(/Nessun utilizzo registrato/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  } finally {
    unmount();
  }
});

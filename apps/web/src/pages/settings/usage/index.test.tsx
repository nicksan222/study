import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { LanguageProvider } from '#web/lib/i18n.tsx';
import { request } from '#web/lib/study-client/request.ts';

import { UsageSettings } from './index';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <LanguageProvider locale="english">
          <UsageSettings />
        </LanguageProvider>
      </QueryClientProvider>
    );

    try {
      expect(await screen.findByText('test-model')).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: '110' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Agent / task' }));
      expect(screen.getByText('reply')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '7 days' }));
      await waitFor(() => expect(client.getQueryData(['ai-usage', 7, ''])).toBeDefined());
      const before = call.mock.calls.length;

      await user.click(screen.getByRole('button', { name: 'Refresh usage' }));
      await waitFor(() => expect(call.mock.calls.length).toBeGreaterThan(before));
    } finally {
      unmount();
      client.clear();
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
  const client = new QueryClient();
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <LanguageProvider locale="italian">
        <UsageSettings />
      </LanguageProvider>
    </QueryClientProvider>
  );

  try {
    expect(await screen.findByText(/Nessun utilizzo registrato/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  } finally {
    unmount();
    client.clear();
  }
});

import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { downloadFile } from '@study/ui/download';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

import { diagnosticLog, hostCapabilities } from '#client/lib/host.ts';
import { LanguageProvider } from '#client/lib/i18n.tsx';

import { AnalyticsSettings } from './analytics';

vi.mock('#client/lib/host.ts', () => ({ diagnosticLog: vi.fn(), hostCapabilities: vi.fn() }));
vi.mock('@study/ui/download', () => ({ downloadFile: vi.fn() }));

const snapshot =
  '2026-01-01T00:00:00Z ERROR panic\n  stack: Needle\n2026-01-01T00:00:01Z INFO ready\n';

function setup(locale: 'english' | 'italian' = 'english') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <LanguageProvider locale={locale}>
        <AnalyticsSettings />
      </LanguageProvider>
    </QueryClientProvider>
  );

  return () => {
    view.unmount();
    client.clear();
  };
}

testStable('searches continuation context and exports the entire snapshot', async () => {
  vi.mocked(hostCapabilities).mockReturnValue({ updates: true, diagnostics: true });
  vi.mocked(diagnosticLog).mockResolvedValue(snapshot);
  const cleanup = setup();

  try {
    const user = userEvent.setup();

    expect(await screen.findByText(/stack: Needle/)).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Severity' }));
    await user.click(await screen.findByRole('option', { name: 'Error' }));
    expect(screen.queryByText(/INFO ready/)).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search logs' }), 'needle');
    expect(screen.getByText(/ERROR panic/)).toHaveTextContent('stack: Needle');
    expect(screen.queryByText(/INFO ready/)).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 events')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export snapshot' }));
    const [name, blob] = vi.mocked(downloadFile).mock.calls.at(-1)!;

    expect(name).toBe('diagnostics.log');
    expect(await (blob as Blob).text()).toBe(snapshot);
    await user.clear(screen.getByRole('searchbox', { name: 'Search logs' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search logs' }), 'missing');
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
  } finally {
    cleanup();
  }
});

testStable.each(['english', 'italian'] as const)('shows browser fallback in %s', (locale) => {
  vi.mocked(hostCapabilities).mockReturnValue({ updates: false, diagnostics: false });
  vi.mocked(diagnosticLog).mockClear();
  const cleanup = setup(locale);

  try {
    expect(screen.getByText(catalogs[locale].AnalyticsDesktop)).toBeInTheDocument();
    expect(diagnosticLog).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

testStable('shows loading, error and recovers to empty on refresh', async () => {
  vi.mocked(hostCapabilities).mockReturnValue({ updates: true, diagnostics: true });
  let reject!: (reason: Error) => void;

  vi.mocked(diagnosticLog)
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    )
    .mockResolvedValueOnce('');
  const cleanup = setup();

  try {
    expect(screen.getByText('Loading logs…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    reject(new Error('unavailable'));
    expect(await screen.findByText('Could not load logs. Try refreshing.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByText('No diagnostic events yet.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Export snapshot' })).toBeDisabled();
  } finally {
    cleanup();
  }
});

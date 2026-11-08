import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { LanguageProvider } from '#web/lib/i18n.tsx';
import { serverConnection } from '#web/lib/study-client/connection.ts';

import { ServerConnection } from './server-connection';

const api = vi.hoisted(() => ({ health: vi.fn(), resetDraft: vi.fn(), save: vi.fn() }));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (...args: unknown[]) => api.health(...args)
}));

const clients: QueryClient[] = [];

const healthy = { protocolVersion: 1, workersRunning: true, testMode: false };

beforeEach(() => {
  serverConnection.recovered(serverConnection.snapshot().revision);
  api.health.mockReset().mockResolvedValue(healthy);
  api.resetDraft.mockReset().mockReturnValue('initial');
  api.save.mockReset().mockRejectedValue(new Error('Offline'));
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

function Draft() {
  const [value, setValue] = useState('');
  const save = useMutation({ mutationFn: api.save });
  const draft = useQuery({
    queryKey: ['note-drafts', '25'],
    queryFn: api.resetDraft,
    initialData: 'open tab',
    staleTime: Infinity,
    gcTime: Infinity
  });

  return (
    <>
      <label>
        Draft
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button onClick={() => save.mutate()}>Save draft</button>
      <p>{draft.data}</p>
      {createPortal(<div role="dialog">Existing dialog</div>, document.body)}
    </>
  );
}

function mount(locale: 'english' | 'italian' = 'english') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(cache);
  const onReconnect = vi.fn();
  const view = render(
    <QueryClientProvider client={cache}>
      <LanguageProvider locale={locale}>
        <ServerConnection onReconnect={onReconnect}>
          <Draft />
        </ServerConnection>
      </LanguageProvider>
    </QueryClientProvider>
  );

  return { ...view, cache, onReconnect };
}

testStable.each(['english', 'italian'] as const)(
  'shows one full-screen outage in %s and restores drafts, tabs and portals',
  async (locale) => {
    const { onReconnect } = mount(locale);

    await waitFor(() => expect(api.health).toHaveBeenCalledOnce());
    const input = screen.getByRole('textbox', { name: 'Draft' });

    fireEvent.change(input, { target: { value: 'My unsent question' } });
    const portal = screen.getByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledOnce());
    api.health.mockRejectedValue(new Error('Offline'));
    act(() => serverConnection.disconnected());
    const copy = catalogs[locale];

    expect(await screen.findByRole('heading', { name: copy.ServerConnectionTitle })).toBeVisible();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(input).not.toBeVisible();
    expect(portal).not.toBeVisible();
    api.health.mockResolvedValue(healthy);
    fireEvent.click(screen.getByRole('button', { name: copy.ServerConnectionRetry }));
    await waitFor(() => expect(input).toBeVisible());
    expect(input).toHaveValue('My unsent question');
    expect(portal).toBeVisible();
    expect(screen.getByText('open tab')).toBeVisible();
    expect(api.resetDraft).not.toHaveBeenCalled();
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(api.save).toHaveBeenCalledOnce();
  }
);

testStable('polling recovers automatically without a click', async () => {
  api.health.mockRejectedValue(new Error('Offline'));
  const { onReconnect } = mount();

  await screen.findByRole('heading', { name: catalogs.english.ServerConnectionTitle });
  api.health.mockResolvedValue(healthy);
  await waitFor(() => expect(onReconnect).toHaveBeenCalledOnce(), { timeout: 3500 });
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBeVisible();
});

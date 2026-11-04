import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { SessionTitleEdit } from './session-title';
import { sessionOptions } from './session-workspace.queries';

const api = vi.hoisted(() => ({ rename: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (fn: (client: unknown) => unknown) => fn({ 'conversations.renameSession': api.rename })
}));

const id = Schema.decodeUnknownSync(sessionIdSchema)(9007199254740993n);

const clients: QueryClient[] = [];

beforeEach(() => vi.resetAllMocks());
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  client.setQueryData(['sessions', 'pages', 'all'], {});
  client.setQueryData(['search', 'Biology'], {});
  render(
    <QueryClientProvider client={client}>
      <SessionTitleEdit id={id} title="Biology" />
    </QueryClientProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionRename' }));

  return client;
}

testStable('saves a trimmed title for the exact session and refreshes navigation', async () => {
  api.rename.mockResolvedValue({ id, title: 'Cell division' });
  const client = mount();
  const input = screen.getByRole('textbox', { name: 'SessionTitle' });

  expect(input).toHaveValue('Biology');
  fireEvent.change(input, { target: { value: '  Cell division  ' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.rename).toHaveBeenCalledExactlyOnceWith({ id, title: 'Cell division' });
  expect(client.getQueryData(sessionOptions(id).queryKey)).toEqual({ id, title: 'Cell division' });
  expect(client.getQueryState(['sessions', 'pages', 'all'])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['search', 'Biology'])?.isInvalidated).toBe(true);
});

testStable('keeps a failed rename available to retry and rejects an empty title', async () => {
  api.rename.mockRejectedValue(new StudyError('transient', 'Offline'));
  mount();
  const input = screen.getByRole('textbox', { name: 'SessionTitle' });

  fireEvent.change(input, { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'My title' } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByText('SessionRequestError');
  expect(input).toHaveValue('My title');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

testStable('cancels without saving', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.rename).not.toHaveBeenCalled();
});

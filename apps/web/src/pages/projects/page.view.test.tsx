import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import { PageView } from './page.view';

vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/study-client/request', () => ({
  request: (...args: unknown[]) => rpc(...args)
}));

it('shows a failed read and allows explicit retry', async () => {
  rpc.mockRejectedValue(new Error('offline'));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PageView />
    </QueryClientProvider>
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('collections.readError');
  const callsBeforeRetry = rpc.mock.calls.length;
  fireEvent.click(screen.getAllByText('collections.retry')[0]!);
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(callsBeforeRetry + 1));
});

it('does not submit a blank collection name or duplicate the global heading', () => {
  rpc.mockResolvedValue({ items: [], next: null });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PageView />
    </QueryClientProvider>
  );
  expect(screen.getByText('collections.create')).toBeDisabled();
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
});

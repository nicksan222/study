import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { material } from '../material-library/test/support';
import { useDocumentMetadata } from './session-document-metadata.queries';

const api = vi.hoisted(() => ({ description: vi.fn(), rename: vi.fn() }));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (run: (rpc: Record<string, unknown>) => unknown) =>
    run({ 'materials.updateDescription': api.description, 'materials.rename': api.rename })
}));

const clients: QueryClient[] = [];

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(client);
  const original = { ...material(), description: 'Original summary' };

  return {
    original,
    ...renderHook(() => useDocumentMetadata(original), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    })
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.description.mockResolvedValue(material());
  api.rename.mockResolvedValue(material());
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

testStable(
  'updates document metadata with the expected stored description and trimmed title',
  async () => {
    const view = mount();

    act(() => {
      view.result.current.setTitle('  Lecture notes  ');
      view.result.current.setDescription('  Study this tomorrow  ');
    });
    await act(() => view.result.current.mutation.mutateAsync());
    expect(api.description).toHaveBeenCalledWith({
      id: view.original.id,
      expectedDescription: 'Original summary',
      description: 'Study this tomorrow'
    });
    expect(api.rename).toHaveBeenCalledWith({ id: view.original.id, title: 'Lecture notes' });
  }
);

testStable('keeps edits on a description conflict and does not rename the material', async () => {
  const view = mount();

  api.description.mockRejectedValue(new Error('conflict'));
  act(() => {
    view.result.current.setDescription('My summary');
    view.result.current.mutation.mutate();
  });
  await waitFor(() => expect(view.result.current.mutation.isError).toBe(true));
  expect(view.result.current.description).toBe('My summary');
  expect(api.rename).not.toHaveBeenCalled();
});

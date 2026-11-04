import { sessionSelectionTargetSchema } from '@study/contracts/conversations/context';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { SelectedTarget } from './selection';

const reads = vi.hoisted(() => ({ version: vi.fn(), material: vi.fn(), document: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../material-library/material-library.queries', () => ({
  versionOptions: (id: unknown) => ({
    queryKey: ['version', String(id)],
    queryFn: () => reads.version(id)
  }),
  materialOptions: (id: unknown) => ({
    queryKey: ['material', String(id)],
    queryFn: () => reads.material(id)
  }),
  materialsOptions: vi.fn()
}));
vi.mock('./session-workspace.queries', () => ({
  sessionDocumentOptions: (id: unknown) => ({
    queryKey: ['document', String(id)],
    queryFn: () => reads.document(id)
  }),
  sessionMaterialSearchOptions: vi.fn(),
  selectionOptions: vi.fn(),
  updateSelection: vi.fn()
}));

const target = Schema.decodeUnknownSync(sessionSelectionTargetSchema)({
  versionId: 41n,
  documentId: 51n,
  scope: {
    kind: 'ranges',
    ranges: [{ versionId: 41n, documentId: 51n, blockId: 'paragraph', start: 5, end: 13 }]
  }
});

const clients: QueryClient[] = [];

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <SelectedTarget target={target} />
    </QueryClientProvider>
  );

  return client;
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});

testStable('labels the retained version and excerpts only its selected range', async () => {
  reads.version.mockResolvedValue({ id: 41n, material_id: 31n, number: 2n });
  reads.material.mockResolvedValue({ title: 'Mechanics', version: { id: 99n } });
  reads.document.mockResolvedValue({
    id: 51n,
    document: { blocks: [{ id: 'paragraph', text: 'Keep selected outside' }] }
  });
  mount();
  expect(await screen.findByText('Mechanics')).toBeVisible();
  expect(await screen.findByText('selected')).toBeVisible();
  expect(screen.getByText('ReaderVersion 2 · SessionRanges · 1')).toBeVisible();
  expect(reads.version).toHaveBeenCalledWith(41n);
  expect(reads.document).toHaveBeenCalledWith(41n);
  expect(reads.version).not.toHaveBeenCalledWith(99n);
  expect(screen.queryByText('Keep selected outside')).toBeNull();
});

testStable('does not display excerpts from a different document identity', async () => {
  reads.version.mockResolvedValue({ id: 41n, material_id: 31n, number: 2n });
  reads.material.mockResolvedValue({ title: 'Mechanics' });
  reads.document.mockResolvedValue({
    id: 52n,
    document: { blocks: [{ id: 'paragraph', text: 'Keep selected outside' }] }
  });
  mount();
  expect(await screen.findByText('SessionReadUnavailable')).toBeVisible();
  expect(screen.queryByText('selected')).toBeNull();
});

testStable(
  'updates the current catalog title without replacing exact retained content with the latest version',
  async () => {
    reads.version.mockResolvedValue({ id: 41n, material_id: 31n, number: 2n });
    reads.material.mockResolvedValue({ title: 'Old catalog title', version: { id: 99n } });
    reads.document.mockImplementation((id) =>
      Promise.resolve({
        id: 51n,
        document: {
          blocks: [
            {
              id: 'paragraph',
              text: id === 41n ? 'Keep selected outside' : 'Latest replacement content'
            }
          ]
        }
      })
    );
    const client = mount();

    expect(await screen.findByText('selected')).toBeVisible();
    expect(await screen.findByText('Old catalog title')).toBeVisible();
    reads.material.mockResolvedValue({ title: 'Renamed catalog title', version: { id: 100n } });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['material', '31'] });
    });
    expect(await screen.findByText('Renamed catalog title')).toBeVisible();
    expect(screen.getByText('selected')).toBeVisible();
    expect(screen.queryByText('Latest replacement content')).toBeNull();
    expect(reads.document.mock.calls.every(([id]) => id === 41n)).toBe(true);
    expect(reads.version.mock.calls.every(([id]) => id === 41n)).toBe(true);
  }
);

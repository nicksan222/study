import { sessionSelectionTargetSchema } from '@study/contracts/conversations/context';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { runRequest } from '#web/lib/effect/runtime.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { authoredDocument } from '../document-editing/test-support';
import { SelectedTarget } from './selection';

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const original = authoredDocument(31n, 'Keep selected outside', 41n);

const exact = original.version!;

const target = Schema.decodeUnknownSync(sessionSelectionTargetSchema)({
  input: { kind: 'document', versionId: exact.id },
  scope: { kind: 'ranges', ranges: [{ blockId: exact.document.blocks[0]!.id, start: 5, end: 13 }] }
});

const clients: QueryClient[] = [];

function mount(owner = { ...original, title: 'Mechanics' }) {
  const rpc = {
    'documents.version': vi
      .fn<StudyClient['documents.version']>()
      .mockReturnValue(Effect.succeed(exact)),
    'documents.document': vi
      .fn<StudyClient['documents.document']>()
      .mockReturnValue(Effect.succeed(owner))
  };

  vi.mocked(request).mockImplementation((invoke, signal) =>
    runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <SelectedTarget target={target} />
    </QueryClientProvider>
  );

  return { client, rpc };
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});
testStable(
  'labels the retained authored version and excerpts only its selected range',
  async () => {
    const { rpc } = mount();

    expect(await screen.findByText('Mechanics')).toBeVisible();
    expect(await screen.findByText('selected')).toBeVisible();
    expect(screen.getByText(`ReaderVersion ${exact.number} · SessionRanges · 1`)).toBeVisible();
    expect(rpc['documents.version']).toHaveBeenCalledExactlyOnceWith({ id: exact.id });
    expect(screen.queryByText('Keep selected outside')).toBeNull();
  }
);
testStable('does not display excerpts under a different authored owner identity', async () => {
  mount(authoredDocument(32n, 'Different owner', 52n));
  expect(await screen.findByText('SessionReadUnavailable')).toBeVisible();
  expect(screen.queryByText('selected')).toBeNull();
});
testStable(
  'updates the catalog title without replacing retained content with the current authored version',
  async () => {
    const { client, rpc } = mount({ ...original, title: 'Old catalog title' });

    expect(await screen.findByText('selected')).toBeVisible();
    expect(await screen.findByText('Old catalog title')).toBeVisible();
    rpc['documents.document'].mockReturnValue(
      Effect.succeed({
        ...authoredDocument(31n, 'Latest replacement content', 99n),
        title: 'Renamed catalog title'
      })
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['documents'] });
    });
    expect(await screen.findByText('Renamed catalog title')).toBeVisible();
    expect(screen.getByText('selected')).toBeVisible();
    expect(screen.queryByText('Latest replacement content')).toBeNull();
    expect(rpc['documents.version'].mock.calls.every(([input]) => input.id === exact.id)).toBe(
      true
    );
  }
);

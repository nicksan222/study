import { chatMessageSchema } from '@study/contracts/notes/schemas';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as Router from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';

import { FailedMessageConversion } from './failed-conversion';

vi.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: vi.fn(() => 'ready') }));
vi.mock('@tanstack/react-router', async (load) => ({
  ...(await load<typeof Router>()),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
}));

const api = vi.hoisted(() => ({ snapshot: vi.fn(), convert: vi.fn(), discard: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#client/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'notes.replySnapshot': api.snapshot,
      'notes.convertMessage': api.convert,
      'notes.deleteMessageVersion': api.discard
    })
}));

const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 2n,
  noteId: 1n,
  role: 'user',
  threadRoot: null,
  replyTo: null,
  activeVersionId: 3n,
  recordingId: null,
  recordingMs: null,
  recordedIn: null,
  createdAt: 1n,
  parts: [],
  citations: [],
  versions: [
    {
      id: 3n,
      number: 1n,
      origin: 'typed',
      status: 'complete',
      text: 'Original',
      basedOn: null,
      instruction: null,
      createdAt: 1n
    },
    {
      id: 4n,
      number: 2n,
      origin: 'convert',
      status: 'failed',
      text: '',
      basedOn: 3n,
      instruction: null,
      createdAt: 2n,
      generationRequestId: 'saved-conversion'
    }
  ]
});

let cache: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useAiReadiness).mockReturnValue('ready');
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  api.snapshot.mockResolvedValue({
    generation: { conversion: { strategyId: 'saved-strategy', baseVersionId: 3n } }
  });
  api.convert.mockResolvedValue({});
  api.discard.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  cache.clear();
});

testStable.each(['retry', 'discard'] as const)(
  'exposes %s for a failed conversion without changing its original input',
  async (action) => {
    render(
      <QueryClientProvider client={cache}>
        <FailedMessageConversion message={message} version={message.versions[1]} />
      </QueryClientProvider>
    );
    expect(screen.getByText('NoteConversionFailed')).toBeVisible();
    const retry = screen.getByRole('button', { name: 'Retry' });

    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(
      action === 'retry' ? retry : screen.getByRole('button', { name: 'NoteDiscardConversion' })
    );
    await waitFor(() => {
      if (action === 'retry')
        expect(api.convert).toHaveBeenCalledWith({
          messageId: 2n,
          expectedActiveVersionId: 3n,
          strategyId: 'saved-strategy'
        });
      else expect(api.discard).toHaveBeenCalledWith({ messageId: 2n, versionId: 4n });
    });
  }
);

testStable('keeps recovery retries blocked while another version has active work', async () => {
  const busy = Schema.decodeUnknownSync(chatMessageSchema)({
    ...message,
    versions: [
      ...message.versions,
      {
        id: 5n,
        number: 3n,
        origin: 'improve',
        status: 'pending',
        text: '',
        basedOn: 3n,
        instruction: null,
        createdAt: 3n
      }
    ]
  });

  render(
    <QueryClientProvider client={cache}>
      <FailedMessageConversion message={busy} version={busy.versions[1]} />
    </QueryClientProvider>
  );
  await waitFor(() => expect(api.snapshot).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'NoteDiscardConversion' })).toBeEnabled();
});

testStable('blocks AI conversion recovery without setup while preserving discard', async () => {
  vi.mocked(useAiReadiness).mockReturnValue('setup');
  render(
    <QueryClientProvider client={cache}>
      <FailedMessageConversion message={message} version={message.versions[1]} />
    </QueryClientProvider>
  );
  await waitFor(() => expect(api.snapshot).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  expect(screen.getByText('AiReadinessSetup')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(api.convert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'NoteDiscardConversion' }));
  await waitFor(() => expect(api.discard).toHaveBeenCalledWith({ messageId: 2n, versionId: 4n }));
});

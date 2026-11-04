import { messagePartSchema } from '@study/contracts/conversations/schemas';
import { sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { request } from '#web/lib/study-client/request.ts';

import { authoredDocument } from '../document-editing/test-support';
import { AttachmentCards } from './attachment-cards';
import { SessionDocumentCard } from './session-document-card';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
vi.mock('../source-library', () => ({
  SourceDeletion: ({
    renderTrigger
  }: {
    renderTrigger?: (show: () => void, open: boolean) => unknown;
  }) => renderTrigger?.(() => {}, false) ?? null,
  SourceVersionDeletion: ({
    renderTrigger
  }: {
    renderTrigger?: (show: () => void, open: boolean) => unknown;
  }) => renderTrigger?.(() => {}, false) ?? null,
  sourceOptions: (id: unknown) => ({
    queryKey: ['item-source', String(id)],
    queryFn: async () => (id === null ? null : { id, name: 'Lecture.pdf', sizeBytes: 10n })
  })
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

testStable.each([false, true])(
  'opens the exact attachment from its context menu (compact: %s)',
  async (compact) => {
    const client = new QueryClient();
    clients.push(client);
    const open = vi.fn();
    const part = Schema.decodeUnknownSync(messagePartSchema)({
      id: 3n,
      sourceId: 7n,
      sourceName: 'Lecture.pdf',
      sourceKind: 'pdf'
    });
    render(
      <QueryClientProvider client={client}>
        <AttachmentCards parts={[part]} compact={compact} onOpenSource={open} />
      </QueryClientProvider>
    );
    await screen.findByRole('button', { name: 'Lecture.pdf' });
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lecture.pdf' })).toBeEnabled()
    );
    const card = screen.getByRole('button', { name: 'Lecture.pdf' });
    expect(screen.queryByRole('button', { name: 'SessionDeleteItem' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SessionDeleteVersion' })).not.toBeInTheDocument();
    fireEvent.contextMenu(card, { button: 2, clientX: 80, clientY: 80 });
    expect(await screen.findByRole('menuitem', { name: 'SessionDeleteItem' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'SessionDeleteVersion' })).toBeVisible();
    expect(open).not.toHaveBeenCalled();
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'OpenMaterial' }));
    expect(open).toHaveBeenCalledExactlyOnceWith({
      id: part.sourceId,
      name: 'Lecture.pdf',
      sizeBytes: 10n
    });
  }
);

testStable('opens the exact authored document from its context menu', async () => {
  const document = authoredDocument();
  const open = vi.fn();
  const client = new QueryClient();
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <SessionDocumentCard document={document} active={false} onOpen={open} />
    </QueryClientProvider>
  );
  expect(screen.queryByRole('button', { name: 'SessionDeleteItem' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'SessionDeleteVersion' })).not.toBeInTheDocument();
  fireEvent.contextMenu(screen.getByRole('button', { name: /New document/ }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  expect(open).not.toHaveBeenCalled();
  expect(await screen.findByRole('menuitem', { name: 'SessionDeleteItem' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'SessionDeleteVersion' })).toBeVisible();
  await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'SessionOpenPage' }));
  expect(open).toHaveBeenCalledExactlyOnceWith(document);
});

testStable('keeps unavailable attachment context actions disabled', async () => {
  const client = new QueryClient();
  clients.push(client);
  const part = Schema.decodeUnknownSync(messagePartSchema)({
    id: 3n,
    sourceId: null,
    sourceName: 'Missing.pdf',
    sourceKind: 'pdf'
  });
  render(
    <QueryClientProvider client={client}>
      <AttachmentCards parts={[part]} onOpenSource={vi.fn()} />
    </QueryClientProvider>
  );
  fireEvent.contextMenu(screen.getByText('Missing.pdf'), { button: 2, clientX: 80, clientY: 80 });
  expect(await screen.findByRole('menuitem', { name: 'OpenMaterial' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
});

testStable.each(['document', 'source'] as const)(
  'archives the exact %s membership in this session',
  async (kind) => {
    const sessionId = Schema.decodeUnknownSync(sessionIdSchema)(15n);
    const archive = vi.fn().mockResolvedValue(undefined);
    vi.mocked(request).mockImplementation(async (invoke) =>
      invoke({ 'conversations.setItemArchived': archive } as never)
    );
    const client = new QueryClient();
    clients.push(client);
    const document = authoredDocument();
    const part = Schema.decodeUnknownSync(messagePartSchema)({
      id: 3n,
      sourceId: 7n,
      sourceName: 'Lecture.pdf',
      sourceKind: 'pdf'
    });
    render(
      <QueryClientProvider client={client}>
        {kind === 'document' ? (
          <SessionDocumentCard
            sessionId={sessionId}
            document={document}
            active={false}
            onOpen={vi.fn()}
          />
        ) : (
          <AttachmentCards sessionId={sessionId} parts={[part]} compact onOpenSource={vi.fn()} />
        )}
      </QueryClientProvider>
    );
    const name = kind === 'document' ? /New document/ : 'Lecture.pdf';
    await screen.findByRole('button', { name });
    await vi.waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    const target = screen.getByRole('button', { name });
    fireEvent.contextMenu(target, { button: 2, clientX: 80, clientY: 80 });
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'SessionArchive' }));
    await vi.waitFor(() =>
      expect(archive).toHaveBeenCalledExactlyOnceWith({
        sessionId,
        target: kind === 'document' ? { kind, id: document.id } : { kind, id: part.sourceId },
        archived: true
      })
    );
  }
);

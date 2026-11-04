import { archivedSessionItemSchema } from '@study/contracts/conversations/archive';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { request } from '#web/lib/study-client/request.ts';

import { authoredDocument } from '../document-editing/test-support';
import { ArchivePanel } from './archive';
import { useItemArchive } from './archive.queries';

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
vi.mock('../document-presentation', () => ({
  DocumentReader: ({ document }: { document: { blocks: readonly { text: string }[] } }) => (
    <article>{document.blocks.map((block) => block.text).join(' ')}</article>
  )
}));
const id = Schema.decodeUnknownSync(sessionIdSchema)(7n);
const document = authoredDocument(31n, 'Archived physics content', 41n);
const item = Schema.decodeUnknownSync(archivedSessionItemSchema)({
  target: { kind: 'document', id: document.id },
  name: 'Physics',
  archivedAt: 1n
});
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});
function mount(children = <ArchivePanel id={id} />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  clients.push(client);
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  return client;
}
function setup(items = [item]) {
  const rpc = {
    'conversations.archivedItems': vi.fn().mockResolvedValue(items),
    'conversations.setItemArchived': vi.fn().mockResolvedValue(undefined),
    'documents.document': vi.fn().mockResolvedValue(document),
    'documents.previewDeletion': vi.fn().mockResolvedValue({
      documentId: document.id,
      token: 'preview',
      versionIds: [document.version!.id],
      blockedVersionIds: []
    }),
    'documents.delete': vi.fn().mockResolvedValue(undefined)
  };
  vi.mocked(request).mockImplementation(async (invoke) => invoke(rpc as never));
  return rpc;
}
testStable('previews archived content read-only and restores the session membership', async () => {
  const rpc = setup();
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Physics' }));
  expect(await screen.findByText('Archived physics content')).toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'SessionDeletePermanently' })).toBeEnabled();
  rpc['conversations.archivedItems'].mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: 'SessionRestore' }));
  await waitFor(() =>
    expect(rpc['conversations.setItemArchived']).toHaveBeenCalledExactlyOnceWith({
      sessionId: id,
      target: item.target,
      archived: false
    })
  );
  await waitFor(() => expect(screen.queryByText('Archived physics content')).toBeNull());
});
testStable(
  'searches only this session archive and distinguishes no matches from empty',
  async () => {
    setup();
    mount();
    await screen.findByRole('button', { name: 'Physics' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(await screen.findByText('SessionArchiveNoMatches')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Physics' })).toBeNull();
  }
);
testStable('shows honest empty and failed archive reads', async () => {
  const rpc = setup([]);
  const client = mount();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('SessionArchiveEmpty'));
  rpc['conversations.archivedItems'].mockRejectedValue(new StudyError('internal', 'Unavailable'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['session-workspace', String(id), 'archived'] });
  });
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  expect(screen.getByText('SessionArchiveLoadFailed')).toBeVisible();
  expect(screen.queryByText('SessionArchiveEmpty')).toBeNull();
  expect(screen.queryByText('SessionReadErrorTitle')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Physics' })).toBeNull();
});
function SharedRestore() {
  const archive = useItemArchive(id, item.target);
  return (
    <button disabled={archive.pending} onClick={() => archive.change(false)}>
      restore
    </button>
  );
}
testStable(
  'fences duplicate archive changes across mounted observers and recovers from failure',
  async () => {
    const rpc = setup();
    let reject!: (error: unknown) => void;
    rpc['conversations.setItemArchived'].mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    mount(
      <>
        <SharedRestore />
        <SharedRestore />
      </>
    );
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(rpc['conversations.setItemArchived']).toHaveBeenCalledTimes(1));
    expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true);
    await act(async () => reject(new StudyError('internal', 'Failed')));
    await waitFor(() => expect(buttons[0]).toBeEnabled());
  }
);

testStable(
  'protects permanent deletion and disables Restore while its confirmation is open',
  async () => {
    const rpc = setup();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Physics' }));
    const restore = await screen.findByRole('button', { name: 'SessionRestore' });
    fireEvent.click(screen.getByRole('button', { name: 'SessionDeletePermanently' }));
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    expect(restore).toBeDisabled();
    expect(rpc['documents.delete']).not.toHaveBeenCalled();
    expect(rpc['conversations.setItemArchived']).not.toHaveBeenCalled();
  }
);

import { StudyError } from '@study/contracts/errors';
import { noteIdSchema } from '@study/contracts/ids';
import { archivedNoteItemSchema } from '@study/contracts/notes/archive';
import { testStable } from '@study/testing/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { ArchivePanel } from './archive';
import { useItemArchive } from './archive.queries';

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock(import('../document-presentation'), async (importOriginal) => ({
  ...(await importOriginal()),
  DocumentReader: ({ document }: { document: { blocks: readonly { text: string }[] } }) => (
    <article>{document.blocks.map((block) => block.text).join(' ')}</article>
  )
}));

const id = Schema.decodeUnknownSync(noteIdSchema)(7n);

const document = authoredPage(31n, 'Archived physics content', 41n);

const item = Schema.decodeUnknownSync(archivedNoteItemSchema)({
  target: { kind: 'page', id: document.id },
  name: 'Physics',
  archivedAt: 1n
});

let fixture: ReturnType<typeof rpcHandlersTransport>;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mount(children = <ArchivePanel id={id} />) {
  render(children, { wrapper: fixture.wrapper });

  return fixture;
}

function setup(items = [item]) {
  const rpc = {
    'notes.archivedItems': vi.fn().mockResolvedValue(items),
    'notes.setItemArchived': vi.fn().mockResolvedValue(undefined),
    'pages.page': vi.fn().mockResolvedValue(document),
    'pages.previewDeletion': vi.fn().mockResolvedValue({
      pageId: document.id,
      token: 'preview',
      versionIds: [document.version!.id],
      blockedVersionIds: [],
      semantics: 'retire_bodies_retain_identities'
    }),
    'pages.delete': vi.fn().mockResolvedValue(undefined)
  };

  fixture = rpcHandlersTransport(rpc);

  return rpc;
}

testStable('previews archived content read-only and restores the note membership', async () => {
  const rpc = setup();

  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Physics' }));
  expect(await screen.findByText('Archived physics content')).toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'NoteDeletePermanently' })).toBeEnabled();
  rpc['notes.archivedItems'].mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: 'NoteRestore' }));
  await waitFor(() =>
    expect(rpc['notes.setItemArchived']).toHaveBeenCalledExactlyOnceWith({
      noteId: id,
      target: item.target,
      archived: false
    })
  );
  await waitFor(() => expect(screen.queryByText('Archived physics content')).toBeNull());
});
testStable('searches only this note archive and distinguishes no matches from empty', async () => {
  setup();
  mount();
  await screen.findByRole('button', { name: 'Physics' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  expect(await screen.findByText('NoteArchiveNoMatches')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Physics' })).toBeNull();
});
testStable('shows honest empty and failed archive reads', async () => {
  const rpc = setup([]);
  const client = mount();

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('NoteArchiveEmpty'));
  rpc['notes.archivedItems'].mockRejectedValue(new StudyError('internal', 'Unavailable'));
  await act(async () => {
    await client.notify();
  });
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  expect(screen.getByText('NoteArchiveLoadFailed')).toBeVisible();
  expect(screen.queryByText('NoteArchiveEmpty')).toBeNull();
  expect(screen.queryByText('NoteReadErrorTitle')).toBeNull();
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

    rpc['notes.setItemArchived'].mockReturnValue(
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
    await waitFor(() => expect(rpc['notes.setItemArchived']).toHaveBeenCalledTimes(1));
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
    const restore = await screen.findByRole('button', { name: 'NoteRestore' });

    fireEvent.click(screen.getByRole('button', { name: 'NoteDeletePermanently' }));
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    expect(restore).toBeDisabled();
    expect(rpc['pages.delete']).not.toHaveBeenCalled();
    expect(rpc['notes.setItemArchived']).not.toHaveBeenCalled();
  }
);

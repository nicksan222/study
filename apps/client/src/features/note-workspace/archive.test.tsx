import { StudyError, noteIdSchema, archivedNoteItemSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './archive';
import type * as __MockType2 from './archive.queries';

let authoredPage: typeof __MockType0.authoredPage;

let ArchivePanel: typeof __MockType1.ArchivePanel;

let useItemArchive: typeof __MockType2.useItemArchive;

const id = Schema.decodeUnknownSync(noteIdSchema)(7n);

function initializeDocument() {
  return authoredPage(31n, 'Archived physics content', 41n);
}

let document: ReturnType<typeof initializeDocument>;

function initializeItem() {
  return Schema.decodeUnknownSync(archivedNoteItemSchema)({
    target: { kind: 'page', id: document.id },
    name: 'Physics',
    archivedAt: 1n
  });
}

let item: ReturnType<typeof initializeItem>;

let fixture: ReturnType<test.unit.Context['rpcHandlersTransport']>;

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('#client/features/document-presentation', async (importOriginal) => ({
    ...(await importOriginal()),
    DocumentReader: ({ document }: { document: { blocks: readonly { text: string }[] } }) => (
      <article>{document.blocks.map((block) => block.text).join(' ')}</article>
    )
  }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./archive');

  ArchivePanel = __mockModule1.ArchivePanel;
  const __mockModule2 = await import('./archive.queries');

  useItemArchive = __mockModule2.useItemArchive;
  document = initializeDocument();
  item = initializeItem();
});

test.unit.afterEach(({ cleanup, vi }) => {
  cleanup();
  vi.resetAllMocks();
});

function mount({ render }: Pick<test.unit.Context, 'render'>, children = <ArchivePanel id={id} />) {
  render(children, { wrapper: fixture.wrapper });

  return fixture;
}

function setup(
  { vi, rpcHandlersTransport }: Pick<test.unit.Context, 'vi' | 'rpcHandlersTransport'>,
  items = [item]
) {
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

test.unit.stable(
  'previews archived content read-only and restores the note membership',
  async ({ fireEvent, screen, expect, waitFor, vi, rpcHandlersTransport, render }) => {
    const rpc = setup({ vi, rpcHandlersTransport });

    mount({ render });
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
  }
);
test.unit.stable(
  'searches only this note archive and distinguishes no matches from empty',
  async ({ screen, fireEvent, expect, vi, rpcHandlersTransport, render }) => {
    setup({ vi, rpcHandlersTransport });
    mount({ render });
    await screen.findByRole('button', { name: 'Physics' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(await screen.findByText('NoteArchiveNoMatches')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Physics' })).toBeNull();
  }
);
test.unit.stable(
  'shows honest empty and failed archive reads',
  async ({ waitFor, expect, screen, act, vi, rpcHandlersTransport, render }) => {
    const rpc = setup({ vi, rpcHandlersTransport }, []);
    const client = mount({ render });

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
  }
);

function SharedRestore() {
  const archive = useItemArchive(id, item.target);

  return (
    <button disabled={archive.pending} onClick={() => archive.change(false)}>
      restore
    </button>
  );
}

test.unit.stable(
  'fences duplicate archive changes across mounted observers and recovers from failure',
  async ({ screen, fireEvent, waitFor, expect, act, vi, rpcHandlersTransport, render }) => {
    const rpc = setup({ vi, rpcHandlersTransport });
    let reject!: (error: unknown) => void;

    rpc['notes.setItemArchived'].mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    mount(
      { render },
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

test.unit.stable(
  'protects permanent deletion and disables Restore while its confirmation is open',
  async ({ fireEvent, screen, expect, vi, rpcHandlersTransport, render }) => {
    const rpc = setup({ vi, rpcHandlersTransport });

    mount({ render });
    fireEvent.click(await screen.findByRole('button', { name: 'Physics' }));
    const restore = await screen.findByRole('button', { name: 'NoteRestore' });

    fireEvent.click(screen.getByRole('button', { name: 'NoteDeletePermanently' }));
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    expect(restore).toBeDisabled();
    expect(rpc['pages.delete']).not.toHaveBeenCalled();
    expect(rpc['notes.setItemArchived']).not.toHaveBeenCalled();
  }
);

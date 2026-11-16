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

let fixture: ReturnType<typeof test.rpcHandlersTransport>;

test.beforeEach(async ({ mock }) => {
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

test.afterEach(() => {
  test.cleanup();
  test.vi.resetAllMocks();
});

function mount(children = <ArchivePanel id={id} />) {
  test.render(children, { wrapper: fixture.wrapper });

  return fixture;
}

function setup(items = [item]) {
  const rpc = {
    'notes.archivedItems': test.vi.fn().mockResolvedValue(items),
    'notes.setItemArchived': test.vi.fn().mockResolvedValue(undefined),
    'pages.page': test.vi.fn().mockResolvedValue(document),
    'pages.previewDeletion': test.vi.fn().mockResolvedValue({
      pageId: document.id,
      token: 'preview',
      versionIds: [document.version!.id],
      blockedVersionIds: [],
      semantics: 'retire_bodies_retain_identities'
    }),
    'pages.delete': test.vi.fn().mockResolvedValue(undefined)
  };

  fixture = test.rpcHandlersTransport(rpc);

  return rpc;
}

test.stable('previews archived content read-only and restores the note membership', async () => {
  const rpc = setup();

  mount();
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Physics' }));
  test.expect(await test.screen.findByText('Archived physics content')).toBeVisible();
  test.expect(test.screen.queryByRole('textbox')).toBeNull();
  test.expect(test.screen.queryByRole('radio')).toBeNull();
  test.expect(test.screen.queryByRole('checkbox')).toBeNull();
  test.expect(test.screen.getByRole('button', { name: 'NoteDeletePermanently' })).toBeEnabled();
  rpc['notes.archivedItems'].mockResolvedValue([]);
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteRestore' }));
  await test.waitFor(() =>
    test.expect(rpc['notes.setItemArchived']).toHaveBeenCalledExactlyOnceWith({
      noteId: id,
      target: item.target,
      archived: false
    })
  );
  await test.waitFor(() =>
    test.expect(test.screen.queryByText('Archived physics content')).toBeNull()
  );
});
test.stable('searches only this note archive and distinguishes no matches from empty', async () => {
  setup();
  mount();
  await test.screen.findByRole('button', { name: 'Physics' });
  test.fireEvent.change(test.screen.getByRole('searchbox'), { target: { value: 'missing' } });
  test.expect(await test.screen.findByText('NoteArchiveNoMatches')).toBeVisible();
  test.expect(test.screen.queryByRole('button', { name: 'Physics' })).toBeNull();
});
test.stable('shows honest empty and failed archive reads', async () => {
  const rpc = setup([]);
  const client = mount();

  await test.waitFor(() =>
    test.expect(test.screen.getByRole('status')).toHaveTextContent('NoteArchiveEmpty')
  );
  rpc['notes.archivedItems'].mockRejectedValue(new StudyError('internal', 'Unavailable'));
  await test.act(async () => {
    await client.notify();
  });
  test.expect(await test.screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  test.expect(test.screen.getByText('NoteArchiveLoadFailed')).toBeVisible();
  test.expect(test.screen.queryByText('NoteArchiveEmpty')).toBeNull();
  test.expect(test.screen.queryByText('NoteReadErrorTitle')).toBeNull();
  test.expect(test.screen.queryByRole('button', { name: 'Physics' })).toBeNull();
});

function SharedRestore() {
  const archive = useItemArchive(id, item.target);

  return (
    <button disabled={archive.pending} onClick={() => archive.change(false)}>
      restore
    </button>
  );
}

test.stable(
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
    const buttons = test.screen.getAllByRole('button');

    test.fireEvent.click(buttons[0]!);
    test.fireEvent.click(buttons[1]!);
    await test.waitFor(() => test.expect(rpc['notes.setItemArchived']).toHaveBeenCalledTimes(1));
    test.expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true);
    await test.act(async () => reject(new StudyError('internal', 'Failed')));
    await test.waitFor(() => test.expect(buttons[0]).toBeEnabled());
  }
);

test.stable(
  'protects permanent deletion and disables Restore while its confirmation is open',
  async () => {
    const rpc = setup();

    mount();
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Physics' }));
    const restore = await test.screen.findByRole('button', { name: 'NoteRestore' });

    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteDeletePermanently' }));
    test.expect(await test.screen.findByRole('alertdialog')).toBeVisible();
    test.expect(restore).toBeDisabled();
    test.expect(rpc['pages.delete']).not.toHaveBeenCalled();
    test.expect(rpc['notes.setItemArchived']).not.toHaveBeenCalled();
  }
);

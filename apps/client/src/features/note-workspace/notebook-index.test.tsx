import { noteIdSchema, chatMessageSchema } from '@study/contracts';
import { rpc as protocol } from '@study/contracts/react';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { authoredPage as summary } from '../document-editing/test-support';
import { History } from './history';
import { WorkspaceContext } from './workspace-context';

const rpc = test.hoisted(() => ({
  thread: test.vi.fn(),
  materials: test.vi.fn(),
  generations: test.vi.fn()
}));

test.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String })
}));
test.mock('./message-actions', () => ({
  MessageActions: ({ children }: { children: React.ReactNode }) => children
}));

const id = Schema.decodeUnknownSync(noteIdSchema)(51n);

const other = Schema.decodeUnknownSync(noteIdSchema)(52n);

const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 71n,
  noteId: id,
  role: 'user',
  threadRoot: null,
  replyTo: null,
  activeVersionId: 83n,
  recordingId: null,
  recordingMs: null,
  recordedIn: null,
  createdAt: 1n,
  parts: [],
  citations: [],
  versions: [
    {
      id: 80n,
      number: 1n,
      origin: 'typed',
      status: 'complete',
      text: 'Original note',
      basedOn: null,
      instruction: null,
      createdAt: 1n
    },
    {
      id: 82n,
      number: 2n,
      origin: 'edited',
      status: 'complete',
      text: 'Different branch',
      basedOn: 80n,
      instruction: null,
      createdAt: 2n
    },
    {
      id: 83n,
      number: 3n,
      origin: 'edited',
      status: 'complete',
      text: 'Current note',
      basedOn: 80n,
      instruction: null,
      createdAt: 3n
    }
  ]
});

function Provider({ children }: { children: React.ReactNode }) {
  const fixture = test.rpcHandlersTransport({
    'pages.pages': rpc.materials,
    'notes.thread': ({ noteId, before, limit }) => rpc.thread(noteId, before, limit),
    'notes.messageVersionCitations': async (input) => ({ ...input, citations: [] }),
    'notes.noteWork': async () => ({ items: [], next: null }),
    'notes.noteGenerations': rpc.generations
  });

  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function Notebook() {
  const pages = protocol.pages.list.useQuery({ noteId: id, limit: 100, archived: false });

  return (
    <History
      id={id}
      pages={pages.data?.items}
      onOpen={() => undefined}
      onOpenPage={() => undefined}
      onOpenSource={() => undefined}
    />
  );
}

function mount(noteId?: typeof id, board = false) {
  return test.render(
    <Provider>
      {board && <Notebook />}
      <WorkspaceContext id={noteId} onOpenSource={() => undefined} />
    </Provider>
  );
}

test.beforeEach(() => {
  test.vi.clearAllMocks();
  rpc.thread.mockResolvedValue({ items: [], next: null });
  rpc.materials.mockResolvedValue({ items: [], nextCursor: null });
  rpc.generations.mockResolvedValue({ items: [], next: null });
  Element.prototype.scrollIntoView = test.vi.fn();
});
test.afterEach(() => {
  test.cleanup();
  test.vi.restoreAllMocks();
});

test.stable('shows a starter index hint without fetching note content', () => {
  mount();
  test.expect(test.screen.getByText('NoteAttachmentsStart')).toBeVisible();
  test.expect(rpc.thread).not.toHaveBeenCalled();
  test.expect(rpc.materials).not.toHaveBeenCalled();
});
test.stable(
  'jumps and focuses actual rendered note, attachment and document targets without preview dialogs',
  async () => {
    const attached = Schema.decodeUnknownSync(chatMessageSchema)({
      ...message,
      parts: [{ id: 101n, sourceId: 201n, sourceName: 'Lecture notes.pdf', sourceKind: 'pdf' }]
    });

    rpc.thread.mockResolvedValue({
      items: [attached, attached, { ...message, noteId: other, id: 99n }],
      next: null
    });
    rpc.materials.mockResolvedValue({
      items: [{ ...summary(91n), title: 'Study outline', kind: 'page' }],
      nextCursor: null
    });
    mount(id, true);
    const index = await test.screen.findByRole('navigation', { name: 'NotePageIndex' });

    for (const name of ['Current note', 'Lecture notes.pdf', 'Study outline']) {
      const link = await test.within(index).findByRole('button', { name });
      const target = document.getElementById(link.getAttribute('data-target')!)!;

      test.expect(target).not.toBeNull();
      const scroll = test.vi.spyOn(target, 'scrollIntoView');

      link.focus();
      await test.userEvent.setup().keyboard('{Enter}');
      test.expect(scroll).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest'
      });
      test.expect(target).toHaveFocus();
    }

    test.expect(test.within(index).getAllByRole('button')).toHaveLength(3);
    test.expect(test.within(index).queryByText('Original note')).toBeNull();
    test.expect(test.within(index).queryByText('Different branch')).toBeNull();
    const card = test.screen.getByRole('complementary', { name: 'NoteContextPanel' });

    test.expect(test.within(card).queryByText('Current note')).toBeNull();
    test.expect(test.within(card).queryByText('Original note')).toBeNull();
    test.expect(test.within(card).getByRole('button', { name: 'Lecture notes.pdf' })).toBeVisible();
    test
      .expect(test.within(card).getByRole('button', { name: 'NoteOpenPage' }))
      .toHaveTextContent('Study outline');
    test.expect(test.screen.queryByRole('dialog')).toBeNull();
    test.expect(rpc.generations).not.toHaveBeenCalled();
  }
);
test.stable(
  'loads earlier notes into both the index and the rendered notebook through authoritative bounded pages',
  async () => {
    rpc.thread.mockImplementation((_id, _before, limit) =>
      Promise.resolve({ items: limit > 30 ? [message] : [], next: limit > 30 ? null : 71n })
    );
    mount(id, true);
    const index = await test.screen.findByRole('navigation', { name: 'NotePageIndex' });

    test.fireEvent.click(await test.within(index).findByRole('button', { name: 'NoteEarlier' }));
    const link = await test.within(index).findByRole('button', { name: 'Current note' });

    test.expect(document.getElementById(link.getAttribute('data-target')!)).not.toBeNull();
    test.expect(rpc.thread).toHaveBeenCalledWith(id, undefined, 60);
  }
);
test.stable('respects reduced motion when jumping to a notebook entry', async () => {
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  mount(id, true);
  const index = await test.screen.findByRole('navigation', { name: 'NotePageIndex' });
  const link = await test.within(index).findByRole('button', { name: 'Current note' });

  test.vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const target = document.getElementById(link.getAttribute('data-target')!)!;
  const scroll = test.vi.spyOn(target, 'scrollIntoView');

  test.fireEvent.click(link);
  test.expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start', inline: 'nearest' });
});
test.stable('does not claim an empty index while data is pending or has failed', async () => {
  rpc.thread.mockRejectedValue(new Error('Read failed'));
  mount(id);
  test.expect(await test.screen.findByRole('alert')).toBeVisible();
  test.expect(test.screen.queryByText('NoteAttachmentsEmpty')).toBeNull();
});

test.stable('previews a note from the tiny rail on both hover and keyboard focus', async () => {
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  mount(id, true);
  const index = await test.screen.findByRole('navigation', { name: 'NotePageIndex' });
  const marker = await test.within(index).findByRole('button', { name: 'Current note' });
  const user = test.userEvent.setup();

  await user.hover(marker);
  test.fireEvent.mouseMove(marker, { movementX: 4, movementY: 0 });
  await test.waitFor(() => test.expect(marker).toHaveAttribute('data-popup-open'));
  test.expect(await test.screen.findByRole('tooltip')).toHaveTextContent('Current note');
  await user.unhover(marker);
  await test.waitFor(() => test.expect(test.screen.queryByRole('tooltip')).toBeNull());
  await user.tab();
  test.expect(marker).toHaveFocus();
  test.expect(await test.screen.findByRole('tooltip')).toHaveTextContent('Current note');
});

test.stable(
  'keeps notebook content ordered and jumpable without repeated dates or timeline wrappers',
  async () => {
    rpc.thread.mockResolvedValue({ items: [message], next: null });
    mount(id, true);
    const board = await test.screen.findByRole('log', { name: 'NoteNotebook' });

    await test.within(board).findByText('Current note');
    test.expect(board.querySelector('time')).toBeNull();
    test.expect(board.querySelector('[data-slot="timeline-event"]')).toBeNull();
    const marker = await test
      .within(test.screen.getByRole('navigation', { name: 'NotePageIndex' }))
      .findByRole('button', { name: 'Current note' });

    test.expect(document.getElementById(marker.getAttribute('data-target')!)).not.toBeNull();
  }
);

test.stable('retains rich document headings and lists in the unboxed notebook', async () => {
  rpc.thread.mockResolvedValue({
    items: [
      {
        ...message,
        format: 'document',
        versions: message.versions.map((version) =>
          version.id === message.activeVersionId
            ? { ...version, text: '## Key idea\n\nA **clear** explanation.\n\n- One\n- Two' }
            : version
        )
      }
    ],
    next: null
  });
  test.render(
    <Provider>
      <History id={id} />
    </Provider>
  );
  const board = await test.screen.findByRole('log', { name: 'NoteNotebook' });

  test
    .expect(await test.within(board).findByRole('heading', { name: 'Key idea', level: 2 }))
    .toBeVisible();
  test.expect(test.within(board).getByText('clear', { selector: 'strong' })).toBeVisible();
  test.expect(test.within(board).getAllByRole('listitem')).toHaveLength(2);
});

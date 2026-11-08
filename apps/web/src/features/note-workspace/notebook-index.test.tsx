import { noteIdSchema } from '@study/contracts/ids';
import { chatMessageSchema } from '@study/contracts/notes/schemas';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { authoredPage as summary } from '../document-editing/test-support';
import { History } from './history';
import { linkedPagesOptions } from './note-page.queries';
import type * as WorkspaceQueries from './note-workspace.queries';
import { WorkspaceContext } from './workspace-context';

const rpc = vi.hoisted(() => ({ thread: vi.fn(), materials: vi.fn(), generations: vi.fn() }));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'pages.pages': rpc.materials,
      'sources.source': async () => ({ sizeBytes: 1n }),
      'notes.messageVersionCitations': async () => ({ citations: [] }),
      'notes.noteGenerations': rpc.generations
    })
}));
vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String })
}));
vi.mock('./message-actions', () => ({
  MessageActions: ({ children }: { children: React.ReactNode }) => children
}));
vi.mock('./note-workspace.queries', async (load) => ({
  ...(await load<typeof WorkspaceQueries>()),
  threadOptions: (id: bigint) => ({
    queryKey: ['index-thread', String(id)],
    initialPageParam: undefined,
    queryFn: ({ pageParam }: { pageParam: unknown }) => rpc.thread(id, pageParam),
    getNextPageParam: (page: { next: bigint | null }) => page.next ?? undefined
  })
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

const clients: QueryClient[] = [];

function Notebook() {
  const pages = useQuery(linkedPagesOptions(id));

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);

  return render(
    <QueryClientProvider client={client}>
      {board && <Notebook />}
      <WorkspaceContext id={noteId} onOpenSource={() => undefined} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.thread.mockResolvedValue({ items: [], next: null });
  rpc.materials.mockResolvedValue({ items: [], nextCursor: null });
  rpc.generations.mockResolvedValue({ items: [], next: null });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

testStable('shows a starter index hint without fetching note content', () => {
  mount();
  expect(screen.getByText('NoteAttachmentsStart')).toBeVisible();
  expect(rpc.thread).not.toHaveBeenCalled();
  expect(rpc.materials).not.toHaveBeenCalled();
});
testStable(
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
    const index = await screen.findByRole('navigation', { name: 'NotePageIndex' });

    for (const name of ['Current note', 'Lecture notes.pdf', 'Study outline']) {
      const link = await within(index).findByRole('button', { name });
      const target = document.getElementById(link.getAttribute('data-target')!)!;

      expect(target).not.toBeNull();
      const scroll = vi.spyOn(target, 'scrollIntoView');

      link.focus();
      await userEvent.setup().keyboard('{Enter}');
      expect(scroll).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest'
      });
      expect(target).toHaveFocus();
    }

    expect(within(index).getAllByRole('button')).toHaveLength(3);
    expect(within(index).queryByText('Original note')).toBeNull();
    expect(within(index).queryByText('Different branch')).toBeNull();
    const card = screen.getByRole('complementary', { name: 'NoteContextPanel' });

    expect(within(card).queryByText('Current note')).toBeNull();
    expect(within(card).queryByText('Original note')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Lecture notes.pdf' })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'NoteOpenPage' })).toHaveTextContent(
      'Study outline'
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rpc.generations).not.toHaveBeenCalled();
  }
);
testStable(
  'loads earlier notes into both the index and the rendered notebook through the shared page cache',
  async () => {
    rpc.thread.mockImplementation((_id, before) =>
      Promise.resolve({ items: before ? [message] : [], next: before ? null : 71n })
    );
    mount(id, true);
    const index = await screen.findByRole('navigation', { name: 'NotePageIndex' });

    fireEvent.click(await within(index).findByRole('button', { name: 'NoteEarlier' }));
    const link = await within(index).findByRole('button', { name: 'Current note' });

    expect(document.getElementById(link.getAttribute('data-target')!)).not.toBeNull();
    expect(rpc.thread).toHaveBeenCalledWith(id, 71n);
  }
);
testStable('respects reduced motion when jumping to a notebook entry', async () => {
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  mount(id, true);
  const index = await screen.findByRole('navigation', { name: 'NotePageIndex' });
  const link = await within(index).findByRole('button', { name: 'Current note' });

  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const target = document.getElementById(link.getAttribute('data-target')!)!;
  const scroll = vi.spyOn(target, 'scrollIntoView');

  fireEvent.click(link);
  expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start', inline: 'nearest' });
});
testStable('does not claim an empty index while data is pending or has failed', async () => {
  rpc.thread.mockRejectedValue(new Error('Read failed'));
  mount(id);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByText('NoteAttachmentsEmpty')).toBeNull();
});

testStable('previews a note from the tiny rail on both hover and keyboard focus', async () => {
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  mount(id, true);
  const index = await screen.findByRole('navigation', { name: 'NotePageIndex' });
  const marker = await within(index).findByRole('button', { name: 'Current note' });
  const user = userEvent.setup();

  await user.hover(marker);
  fireEvent.mouseMove(marker, { movementX: 4, movementY: 0 });
  await waitFor(() => expect(marker).toHaveAttribute('data-popup-open'));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Current note');
  await user.unhover(marker);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  await user.tab();
  expect(marker).toHaveFocus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Current note');
});

testStable(
  'keeps notebook content ordered and jumpable without repeated dates or timeline wrappers',
  async () => {
    rpc.thread.mockResolvedValue({ items: [message], next: null });
    mount(id, true);
    const board = await screen.findByRole('log', { name: 'NoteNotebook' });

    await within(board).findByText('Current note');
    expect(board.querySelector('time')).toBeNull();
    expect(board.querySelector('[data-slot="timeline-event"]')).toBeNull();
    const marker = await within(
      screen.getByRole('navigation', { name: 'NotePageIndex' })
    ).findByRole('button', { name: 'Current note' });

    expect(document.getElementById(marker.getAttribute('data-target')!)).not.toBeNull();
  }
);

testStable('retains rich document headings and lists in the unboxed notebook', async () => {
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <History id={id} />
    </QueryClientProvider>
  );
  const board = await screen.findByRole('log', { name: 'NoteNotebook' });

  expect(await within(board).findByRole('heading', { name: 'Key idea', level: 2 })).toBeVisible();
  expect(within(board).getByText('clear', { selector: 'strong' })).toBeVisible();
  expect(within(board).getAllByRole('listitem')).toHaveLength(2);
});

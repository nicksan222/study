import { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { sessionIdSchema } from '@study/contracts/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { changeVersions, sessionChanges } from './changes';
import { WorkspaceContext } from './workspace-context';

const rpc = vi.hoisted(() => ({ thread: vi.fn(), generations: vi.fn(), imported: vi.fn() }));
vi.mock('../../lib/study-client/request', () => ({
  request: (fn: (client: { 'materials.importedMaterial': typeof rpc.imported }) => unknown) =>
    fn({ 'materials.importedMaterial': rpc.imported })
}));
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../material-library/exact-document', () => ({
  ExactDocument: ({ id }: { id: bigint }) => <div>Exact document {String(id)}</div>
}));
vi.mock('./session-workspace.queries', async (load) => ({
  ...(await load<typeof import('./session-workspace.queries')>()),
  threadOptions: (id: bigint) => ({
    queryKey: ['changes-thread', String(id)],
    initialPageParam: undefined,
    queryFn: ({ pageParam }: { pageParam: unknown }) => rpc.thread(id, pageParam),
    getNextPageParam: (page: { next: bigint | null }) => page.next ?? undefined
  }),
  sessionGenerationsOptions: (id: bigint) => ({
    queryKey: ['changes-generations', String(id)],
    initialPageParam: undefined,
    queryFn: ({ pageParam }: { pageParam: unknown }) => rpc.generations(id, pageParam),
    getNextPageParam: (page: { next: string | null }) => page.next ?? undefined
  }),
  generationOptions: (id: string) => ({
    queryKey: ['changes-generation', id],
    queryFn: async () => ({ title: 'Generated outline' })
  })
}));
const id = Schema.decodeUnknownSync(sessionIdSchema)(51n);
const other = Schema.decodeUnknownSync(sessionIdSchema)(52n);
const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 71n,
  sessionId: id,
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
function mount(sessionId?: typeof id) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceContext id={sessionId} />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  rpc.thread.mockResolvedValue({ items: [], next: null });
  rpc.generations.mockResolvedValue({ items: [], next: null });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});
it('filters foreign sessions and deduplicates overlapping pages', () => {
  expect(
    sessionChanges(id, [
      message,
      { ...message, sessionId: other, id: 99n as typeof message.id },
      message
    ])
  ).toEqual([message]);
});
it('compares the exact basedOn version rather than the previous array entry', () => {
  expect(changeVersions(message)).toMatchObject({
    current: { text: 'Current note' },
    previous: { text: 'Original note' }
  });
  expect(changeVersions({ ...message, activeVersionId: null })).toEqual({
    current: undefined,
    previous: undefined
  });
});
it('shows an honest starter state without fetching any session', () => {
  mount();
  expect(screen.getByText('SessionChangesStart')).toBeVisible();
  expect(rpc.thread).not.toHaveBeenCalled();
  expect(rpc.generations).not.toHaveBeenCalled();
});
it('opens a read-only exact before/current preview and excludes other sessions', async () => {
  rpc.thread.mockResolvedValue({
    items: [message, { ...message, sessionId: other, id: 99n }],
    next: null
  });
  mount(id);
  const row = await screen.findByRole('button', { name: /Current note/ });
  fireEvent.click(row);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Original note')).toBeVisible();
  expect(within(dialog).getByText('Current note')).toBeVisible();
  expect(within(dialog).queryByText('Different branch')).toBeNull();
  expect(within(dialog).queryByRole('textbox')).toBeNull();
  expect(screen.getAllByRole('button', { name: /Current note/, hidden: true })).toHaveLength(1);
});
it('paginates both canonical feeds and previews an exact proposed document', async () => {
  rpc.thread.mockImplementation((_id, before) =>
    Promise.resolve({ items: before ? [message] : [], next: before ? null : 71n })
  );
  rpc.generations.mockImplementation((_id, before) =>
    Promise.resolve({
      items: before
        ? [
            {
              requestId: 'request',
              contextRequestId: null,
              state: 'available',
              cancelled: false,
              resultVersionId: null,
              proposedVersionId: 91n,
              baseVersionId: 90n
            }
          ]
        : [],
      next: before ? null : 'cursor'
    })
  );
  mount(id);
  fireEvent.click(await screen.findByRole('button', { name: 'SessionChangesMore' }));
  fireEvent.click(await screen.findByRole('button', { name: /Generated outline/ }));
  expect(await screen.findByText('Exact document 91')).toBeVisible();
  expect(rpc.thread).toHaveBeenCalledWith(id, 71n);
  expect(rpc.generations).toHaveBeenCalledWith(id, 'cursor');
});
it('never retains a previous session preview when session identity changes', async () => {
  rpc.thread.mockImplementation((sessionId) =>
    Promise.resolve({ items: sessionId === id ? [message] : [], next: null })
  );
  const view = mount(id);
  fireEvent.click(await screen.findByRole('button', { name: /Current note/ }));
  view.rerender(
    <QueryClientProvider client={clients[0]!}>
      <WorkspaceContext id={other} />
    </QueryClientProvider>
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await screen.findByText('SessionChangesEmpty')).toBeVisible();
});
it('keeps incomplete replies visible even before any text arrives', async () => {
  rpc.thread.mockResolvedValue({
    items: [
      {
        ...message,
        role: 'assistant',
        versions: [{ ...message.versions[2], text: '', status: 'pending' }]
      }
    ],
    next: null
  });
  mount(id);
  expect(await screen.findByRole('button', { name: /SessionPending/ })).toBeVisible();
});
it('does not report an empty session while canonical data is pending', async () => {
  rpc.thread.mockReturnValue(new Promise(() => {}));
  mount(id);
  expect(await screen.findByRole('status')).toHaveTextContent('LoadingStudy');
  expect(screen.queryByText('SessionChangesEmpty')).toBeNull();
});

it('keeps canonical read errors recoverable without claiming there are no changes', async () => {
  rpc.thread.mockRejectedValue(new Error('Read failed'));
  mount(id);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByText('SessionChangesEmpty')).toBeNull();
});

it('resolves attachments by retained source identity and previews their canonical version', async () => {
  const attached = Schema.decodeUnknownSync(chatMessageSchema)({
    ...message,
    parts: [{ id: 101n, sourceId: 201n, sourceName: 'Lecture notes.pdf', sourceKind: 'pdf' }]
  });
  rpc.thread.mockResolvedValue({ items: [attached], next: null });
  rpc.imported.mockResolvedValue({ version: { id: 301n } });
  mount(id);
  fireEvent.click(await screen.findByRole('button', { name: /Lecture notes.pdf/ }));
  expect(await screen.findByText('Exact document 301')).toBeVisible();
  expect(rpc.imported).toHaveBeenCalledWith({ sourceId: 201n });
});

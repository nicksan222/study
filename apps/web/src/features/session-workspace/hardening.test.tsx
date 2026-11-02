import { sessionSelectionSchema } from '@study/contracts/conversations/context';
import { sessionDeletionSchema } from '@study/contracts/conversations/deletion';
import { chatMessageSchema, sessionSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { projectIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { materialGenerationSnapshotSchema } from '@study/contracts/materials/schemas';
import { executionSchema } from '@study/contracts/workflows/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  stringifySearchWith,
  RouterProvider
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { versionOptions } from '../material-library/material-library.queries';
import {
  deferred,
  exactDocument,
  importedVersion,
  summary
} from '../material-library/test/support';
import { History, CapturedContext } from './history';
import { SelectionPanel } from './selection';
import {
  executionOptions,
  exactDocumentOptions,
  contextOptions,
  provenanceOptions,
  generationOptions,
  selectionOptions,
  sessionPagesOptions
} from './session-workspace.queries';
import { Transformation } from './transformation';
import { SessionWorkspace } from './workspace';

const rpc = vi.hoisted(() => ({
  session: vi.fn(),
  generations: vi.fn(),
  citations: vi.fn(),
  provenance: vi.fn(),
  deletion: vi.fn(),
  retryDeletion: vi.fn(),
  create: vi.fn(),
  sessions: vi.fn(),
  selection: vi.fn(),
  updateSelection: vi.fn(),
  generation: vi.fn(),
  executions: vi.fn(),
  retryGeneration: vi.fn(),
  cancel: vi.fn(),
  context: vi.fn(),
  thread: vi.fn(),
  materials: vi.fn(),
  version: vi.fn(),
  document: vi.fn()
}));
vi.mock('../../lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
}));
vi.mock('../../lib/study-client/client', async () => {
  const { Effect } = await import('effect');
  const call = (handler: (input: unknown) => unknown) => (input: unknown) =>
    Effect.tryPromise({ try: () => Promise.resolve(handler(input)), catch: (error) => error });
  return {
    studyClient: Effect.succeed({
      'conversations.session': call(rpc.session),
      'conversations.sessionGenerations': call(rpc.generations),
      'conversations.messageVersionCitations': call(rpc.citations),
      'conversations.replyVersion': call(rpc.provenance),
      'conversations.sessionDeletion': call(rpc.deletion),
      'conversations.retrySessionDeletion': call(rpc.retryDeletion),
      'conversations.createUntitledSession': call(rpc.create),
      'conversations.sessions': call(rpc.sessions),
      'conversations.sessionSelection': call(rpc.selection),
      'conversations.updateSessionSelection': call(rpc.updateSelection),
      'conversations.inspectSessionContext': call(rpc.context),
      'conversations.thread': call(rpc.thread),
      'materials.materialGeneration': call(rpc.generation),
      'materials.retryMaterialGeneration': call(rpc.retryGeneration),
      'materials.cancelMaterialGeneration': call(rpc.cancel),
      'materials.materials': call(rpc.materials),
      'materials.materialVersion': call(rpc.version),
      'materials.materialVersionDocument': call(rpc.document),
      'workflows.executions': call(rpc.executions)
    })
  };
});
const id = Schema.decodeUnknownSync(sessionIdSchema)(9007199254740993n);
const draftKey = ['session-drafts', String(id), 'selection'];
const selection = (revision = 8n, targets: readonly unknown[] = []) =>
  Schema.decodeUnknownSync(sessionSelectionSchema)({ revision, targets });
const target = (versionId: bigint) => ({ versionId, scope: { kind: 'document' } });
const generation = (patch = {}) =>
  Schema.decodeUnknownSync(materialGenerationSnapshotSchema)({
    id: 'transform-1',
    title: 'Derivative',
    kind: 'document',
    inputVersionIds: [],
    documentTransform: { contextRequestId: 'capture-1', operations: ['clarity'] },
    documentIds: [],
    cancelled: false,
    report: null,
    resultVersionId: null,
    ...patch
  });
const execution = (name: string) =>
  Schema.decodeUnknownSync(executionSchema)({
    id: name,
    workflow: 'MaterialGeneration',
    correlationId: 'transform-1',
    status: 'completed',
    outcome: 'failure',
    failureKind: 'transient',
    canCancel: false,
    createdAtMs: 1n,
    updatedAtMs: 2n
  });
const caches: QueryClient[] = [];
function cache() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  caches.push(client);
  return client;
}
function mount(children: ReactNode, client = cache(), search = '') {
  const root = createRootRoute({
    validateSearch: (value) => value as { id?: string; project?: string },
    component: () => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
  const router = createRouter({
    routeTree: root,
    parseSearch: (value) => Object.fromEntries(new URLSearchParams(value)),
    stringifySearch: stringifySearchWith(String),
    history: createMemoryHistory({ initialEntries: [`/${search}`] })
  });
  return { client, ...render(<RouterProvider router={router} />) };
}
async function openSection(name: string) {
  fireEvent.click(await screen.findByText(name));
}
function seedTransform(client: QueryClient) {
  rpc.generations.mockResolvedValue({
    items: [
      {
        requestId: 'transform-1',
        contextRequestId: 'capture-1',
        state: 'available',
        cancelled: false,
        resultVersionId: null,
        proposedVersionId: null,
        baseVersionId: null
      }
    ],
    next: null
  });
  client.setQueryData(['session-drafts', String(id), 'transform'], {
    title: 'Derivative',
    instruction: 'Clarify',
    operations: ['clarity'],
    requestId: 'transform-1',
    runs: [{ id: 'transform-1', contextId: 'capture-1' }]
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  rpc.sessions.mockResolvedValue({ items: [], next: null });
  rpc.generations.mockResolvedValue({ items: [], next: null });
  rpc.citations.mockResolvedValue({ citations: [] });
  rpc.selection.mockResolvedValue(selection());
  rpc.executions.mockResolvedValue({ items: [], next: null });
  rpc.generation.mockResolvedValue(generation());
  rpc.thread.mockResolvedValue({ items: [], next: null });
  rpc.materials.mockResolvedValue({ items: [], nextCursor: null });
  rpc.version.mockImplementation(({ id }) => importedVersion(id));
  rpc.document.mockImplementation(({ id }) => exactDocument(id));
  rpc.context.mockResolvedValue({
    requestId: 'capture-1',
    sessionId: id,
    intentKey: 'capture-key',
    instruction: 'Clarify',
    preferences: {},
    selectionRevision: 8n,
    inputs: [],
    messages: [],
    excludedMessages: 0
  });
});
afterEach(() => {
  for (const client of caches.splice(0)) client.clear();
});

it.each(['pending', 'failed', 'completed'] as const)(
  'recovers a cold deleted page with a %s receipt',
  async (status) => {
    rpc.session.mockRejectedValue(new StudyError('not_found', 'Deleted'));
    const receipt = Schema.decodeUnknownSync(sessionDeletionSchema)({
      sessionId: id,
      operationId: 'delete-1',
      status,
      errorKind: status === 'failed' ? 'transient' : null,
      attempt: 1,
      completedAt: status === 'completed' ? 2n : null
    });
    rpc.deletion.mockResolvedValue(receipt);
    rpc.retryDeletion.mockResolvedValue({ ...receipt, status: 'pending', attempt: 2 });
    mount(<SessionWorkspace />, cache(), `?id=${id}`);
    if (status === 'failed') {
      fireEvent.click(await screen.findByRole('button', { name: 'SessionRetryDelete' }));
      await waitFor(() => expect(rpc.retryDeletion).toHaveBeenCalledWith({ id }));
      await screen.findByText('SessionDeleting');
    } else {
      await screen.findByText(status === 'pending' ? 'SessionDeleting' : 'SessionDeleted');
    }
    expect(rpc.deletion).toHaveBeenCalledWith({ id });
    expect(screen.queryByRole('button', { name: 'SessionAsk' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SessionConfirmDelete' })).not.toBeInTheDocument();
    expect(rpc.selection).not.toHaveBeenCalled();
  }
);

it('requires successful list review and deliberate acknowledgment before another ambiguous create', async () => {
  rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
  const first = mount(<SessionWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: 'SessionNew' }));
  await screen.findByText('SessionCreationUncertain');
  first.unmount();
  mount(<SessionWorkspace />, first.client);
  expect(await screen.findByRole('button', { name: 'SessionNew' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'SessionCreationReviewed' })).not.toBeInTheDocument();
  await waitFor(() => expect(rpc.sessions).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!).toBeEnabled()
  );
  rpc.sessions.mockRejectedValueOnce(new StudyError('transient', 'Offline'));
  fireEvent.click(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!);
  await waitFor(() => expect(rpc.sessions).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!).toBeEnabled()
  );
  expect(screen.queryByRole('button', { name: 'SessionCreationReviewed' })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!);
  fireEvent.click(await screen.findByRole('button', { name: 'SessionCreationReviewed' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'SessionNew' })).toBeEnabled());
  expect(rpc.create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'SessionNew' }));
  await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(2));
});

it('allows another create after a definite invalid-input rejection without replaying automatically', async () => {
  rpc.create.mockRejectedValue(new StudyError('invalid_input', 'Rejected before commit'));
  mount(<SessionWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: 'SessionNew' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'SessionNew' })).toBeEnabled();
  expect(screen.queryByText('SessionCreationUncertain')).not.toBeInTheDocument();
  expect(rpc.create).toHaveBeenCalledTimes(1);
});

it('persists an ambiguous retry key across remounts and waits for its exact execution before another retry', async () => {
  rpc.executions.mockImplementation(({ eventId }) => ({
    items: eventId ? [] : [execution('old-failure')],
    next: null
  }));
  rpc.retryGeneration
    .mockRejectedValueOnce(new StudyError('transient', 'Receipt lost'))
    .mockResolvedValue(generation());
  const client = cache();
  seedTransform(client);
  const first = mount(<Transformation id={id} />, client);
  await openSection('SessionTransform');
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(rpc.retryGeneration).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBe(2));
  const original = rpc.retryGeneration.mock.calls[0]![0];
  first.unmount();
  const second = mount(<Transformation id={id} />, client);
  await openSection('SessionTransform');
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(rpc.retryGeneration).toHaveBeenCalledTimes(2));
  expect(rpc.retryGeneration.mock.calls[1]![0]).toEqual(original);
  await waitFor(() =>
    expect(rpc.executions).toHaveBeenCalledWith({
      correlationId: 'transform-1',
      eventId: original.retryId,
      limit: 30
    })
  );
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  );
  second.unmount();
  mount(<Transformation id={id} />, client);
  await openSection('SessionTransform');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  );
  await waitFor(() =>
    expect(client.isFetching({ queryKey: ['session-execution', 'transform-1'] })).toBe(0)
  );
  // A newer unrelated failure must not authorize another retry of this attempt.
  await act(async () => {
    client.setQueryData(executionOptions('transform-1').queryKey, {
      items: [execution('unrelated')],
      next: null
    });
  });
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  await act(async () => {
    const failed = execution('retry-failure');
    client.setQueryData(executionOptions('transform-1').queryKey, { items: [failed], next: null });
    client.setQueryData(executionOptions('transform-1', original.retryId).queryKey, {
      items: [failed],
      next: null
    });
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(rpc.retryGeneration).toHaveBeenCalledTimes(3));
  expect(rpc.retryGeneration.mock.calls[2]![0].retryId).not.toBe(original.retryId);
});

it('keeps cancelled transforms terminal and offers a fresh transform instead', async () => {
  rpc.generation.mockResolvedValue(generation({ cancelled: true }));
  rpc.executions.mockResolvedValue({ items: [execution('old-failure')], next: null });
  const client = cache();
  seedTransform(client);
  mount(<Transformation id={id} />, client);
  await openSection('SessionTransform');
  await screen.findByText('SessionCancelledTransform');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'SessionCancel' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'SessionNewTransform' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionCreateDocument' })).toBeEnabled()
  );
  expect(rpc.retryGeneration).not.toHaveBeenCalled();
});

it('invalidates cached Library and selection search once per committed publication across remounts', async () => {
  const client = cache();
  seedTransform(client);
  const libraryKey = ['materials', 'library', undefined];
  const searchKey = ['session-material-search', 'Derivative'];
  client.setQueryData(libraryKey, {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [undefined]
  });
  client.setQueryData(searchKey, { hits: [] });
  const first = mount(<Transformation id={id} />, client);
  await openSection('SessionTransform');
  await waitFor(() => expect(rpc.generation).toHaveBeenCalled());
  await waitFor(() =>
    expect(client.isFetching({ queryKey: ['session-generation', 'transform-1'] })).toBe(0)
  );
  const invalidations = vi.spyOn(client, 'invalidateQueries');
  await act(async () => {
    client.setQueryData(
      generationOptions('transform-1').queryKey,
      generation({ resultVersionId: 51n })
    );
  });
  await waitFor(() => expect(client.getQueryState(libraryKey)?.isInvalidated).toBe(true));
  expect(client.getQueryState(searchKey)?.isInvalidated).toBe(true);
  expect(invalidations).toHaveBeenCalledWith({ queryKey: ['materials'] });
  expect(invalidations).toHaveBeenCalledWith({ queryKey: ['session-material-search'] });
  first.unmount();
  invalidations.mockClear();
  rpc.generation.mockResolvedValue(generation({ resultVersionId: 51n }));
  mount(<Transformation id={id} />, client);
  await openSection('SessionTransform');
  await waitFor(() => expect(rpc.generation).toHaveBeenCalledTimes(2));
  expect(invalidations).not.toHaveBeenCalledWith({ queryKey: ['materials'] });
});

it.each([false, true])(
  'preserves newer selection drafts and monotonic canonical revisions (newer receipt: %s)',
  async (newerReceipt) => {
    let resolve!: (value: ReturnType<typeof selection>) => void;
    rpc.updateSelection.mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        })
    );
    const client = cache();
    const submitted = selection(8n, [target(11n)]);
    client.setQueryData(draftKey, submitted);
    const first = mount(<SelectionPanel id={id} />, client);
    await openSection('SessionSelection');
    fireEvent.click(await screen.findByRole('button', { name: 'SessionSaveSelection' }));
    await waitFor(() =>
      expect(rpc.updateSelection).toHaveBeenCalledWith({
        sessionId: id,
        expectedRevision: 8n,
        targets: submitted.targets
      })
    );
    first.unmount();
    mount(<SelectionPanel id={id} />, client);
    await openSection('SessionSelection');
    expect(await screen.findByRole('button', { name: 'SessionSaveSelection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SessionRemove' })).toBeDisabled();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    // Model a newer cache writer while the original observer is unmounted.
    const later = selection(newerReceipt ? 10n : 8n, [target(12n)]);
    await act(async () => {
      client.setQueryData(draftKey, later);
      if (newerReceipt)
        client.setQueryData(selectionOptions(id).queryKey, selection(10n, [target(13n)]));
      resolve(selection(9n, submitted.targets));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionSaveSelection' })).toBeEnabled()
    );
    expect(client.getQueryData(draftKey)).toEqual({ ...later, revision: newerReceipt ? 10n : 9n });
    expect(client.getQueryData(selectionOptions(id).queryKey)).toEqual(
      selection(newerReceipt ? 10n : 9n, newerReceipt ? [target(13n)] : submitted.targets)
    );
    expect(screen.getByText('SessionSelectionUnsaved')).toBeInTheDocument();
  }
);

it('exposes operation toggle state and contextual version groups', async () => {
  const client = cache();
  const message = (messageId: bigint) =>
    Schema.decodeUnknownSync(chatMessageSchema)({
      id: messageId,
      sessionId: id,
      role: 'user',
      threadRoot: null,
      replyTo: null,
      activeVersionId: 22n,
      recordingId: null,
      recordingMs: null,
      recordedIn: null,
      createdAt: 1n,
      parts: [],
      citations: [],
      versions: [21n, 22n].map((versionId, index) => ({
        id: versionId,
        number: BigInt(index + 1),
        origin: 'typed',
        status: 'complete',
        text: `Note ${messageId} version ${index + 1}`,
        basedOn: null,
        instruction: null,
        createdAt: 1n
      }))
    });
  rpc.thread.mockResolvedValue({ items: [message(1n), message(2n)], next: null });
  mount(
    <>
      <Transformation id={id} />
      <History id={id} />
    </>,
    client
  );
  await openSection('SessionTransform');
  for (const summary of await screen.findAllByText('SessionVersions', { selector: 'summary' }))
    fireEvent.click(summary);
  const clarity = await screen.findByRole('button', { name: 'SessionOpClarity' });
  expect(clarity).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(clarity);
  await waitFor(() => expect(clarity).toHaveAttribute('aria-pressed', 'false'));
  const groups = await screen.findAllByRole('group', { name: /^SessionNote/ });
  expect(groups).toHaveLength(2);
  expect(groups[0]!.getAttribute('aria-label')).not.toBe(groups[1]!.getAttribute('aria-label'));
  const group = within(groups[0]!);
  expect(group.getByRole('button', { name: 'ReaderVersion 2' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(group.getByRole('button', { name: 'ReaderVersion 1' }));
  expect(group.getByRole('button', { name: 'ReaderVersion 1' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(group.getByRole('button', { name: 'ReaderVersion 2' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
});

it('exposes exact block selection state and saves canonical native Document targets', async () => {
  rpc.materials.mockResolvedValue({ items: [summary()], nextCursor: null });
  rpc.updateSelection.mockImplementation(({ targets }) => selection(9n, targets));
  const client = cache();
  mount(<SelectionPanel id={id} />, client);
  await openSection('SessionSelection');
  const choice = await screen.findByText('Material 41 · ReaderVersion 2');
  fireEvent.click(choice);
  const block = await screen.findByRole('button', { name: 'SessionUseBlock · b0' });
  expect(block).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(block);
  await waitFor(() => expect(block).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveSelection' }));
  await waitFor(() =>
    expect(rpc.updateSelection).toHaveBeenCalledWith({
      sessionId: id,
      expectedRevision: 8n,
      targets: [{ versionId: 102n, documentId: 1102n, scope: { kind: 'blocks', blockIds: ['b0'] } }]
    })
  );
  await waitFor(() =>
    expect(screen.queryByText('SessionSelectionUnsaved')).not.toBeInTheDocument()
  );
  expect(block).toHaveAttribute('aria-pressed', 'true');
});

it('clears only the submitted selection draft after a late receipt across navigation', async () => {
  const pending = deferred<ReturnType<typeof selection>>();
  rpc.updateSelection.mockReturnValue(pending.promise);
  const client = cache();
  const submitted = selection(8n, [target(11n)]);
  client.setQueryData(draftKey, submitted);
  const first = mount(<SelectionPanel id={id} />, client);
  await openSection('SessionSelection');
  fireEvent.click(await screen.findByRole('button', { name: 'SessionSaveSelection' }));
  await waitFor(() => expect(rpc.updateSelection).toHaveBeenCalledTimes(1));
  first.unmount();
  mount(<SelectionPanel id={id} />, client);
  await openSection('SessionSelection');
  expect(await screen.findByRole('button', { name: 'SessionSaveSelection' })).toBeDisabled();
  await act(async () => pending.resolve(selection(9n, submitted.targets)));
  await waitFor(() =>
    expect(screen.queryByText('SessionSelectionUnsaved')).not.toBeInTheDocument()
  );
  expect(client.getQueryData(draftKey)).toBeNull();
});

it.each([undefined, null, Schema.decodeUnknownSync(projectIdSchema)(9007199254740995n)])(
  'keys session pages by native project filter %s',
  async (project) => {
    const client = cache();
    const options = sessionPagesOptions(project);
    await client.fetchInfiniteQuery(options);
    expect(rpc.sessions).toHaveBeenCalledWith({ limit: 30, project, before: undefined });
    expect(options.queryKey).not.toEqual(
      sessionPagesOptions(project === undefined ? null : undefined).queryKey
    );
  }
);

it('uses the routed project filter before pagination and trusts the server page', async () => {
  const project = Schema.decodeUnknownSync(projectIdSchema)(9007199254740995n);
  const cursor = { updatedAt: 2n, id };
  const item = Schema.decodeUnknownSync(sessionSchema)({
    id,
    title: 'Server-selected session',
    titleSource: 'user',
    projectIds: [project],
    createdAt: 1n,
    updatedAt: 2n
  });
  rpc.sessions
    .mockResolvedValueOnce({ items: [item], next: cursor })
    .mockResolvedValue({ items: [], next: null });
  const client = cache();
  client.setQueryData(['session-workspace', 'creation'], { uncertain: true });
  mount(<SessionWorkspace />, client, `?project=${project}`);
  expect(await screen.findByText('Server-selected session')).toBeInTheDocument();
  expect(rpc.sessions).toHaveBeenCalledWith({ limit: 30, project, before: undefined });
  fireEvent.click(screen.getByRole('button', { name: 'LibraryMore' }));
  await waitFor(() =>
    expect(rpc.sessions).toHaveBeenCalledWith({ limit: 30, project, before: cursor })
  );
});

it('keeps global, projectless and membership pages in distinct query-cache entries', async () => {
  const client = cache();
  const project = Schema.decodeUnknownSync(projectIdSchema)(9007199254740995n);
  const filters = [undefined, null, project];
  for (const filter of filters)
    await client.fetchInfiniteQuery({ ...sessionPagesOptions(filter), staleTime: Infinity });
  expect(rpc.sessions).toHaveBeenCalledTimes(3);
  expect(client.getQueryCache().findAll({ queryKey: ['sessions', 'pages'] })).toHaveLength(3);
  expect(sessionPagesOptions().queryKey).toEqual(sessionPagesOptions(undefined).queryKey);
});

it('queries citations for the exact viewed historical version, with no active-version fallback', async () => {
  const message = Schema.decodeUnknownSync(chatMessageSchema)({
    id: 61n,
    sessionId: id,
    role: 'user',
    threadRoot: null,
    replyTo: null,
    activeVersionId: 63n,
    recordingId: null,
    recordingMs: null,
    recordedIn: null,
    createdAt: 1n,
    parts: [],
    citations: [],
    versions: [62n, 63n].map((versionId, index) => ({
      id: versionId,
      number: BigInt(index + 1),
      origin: 'typed',
      status: 'complete',
      text: `version ${index + 1}`,
      basedOn: null,
      instruction: null,
      createdAt: 1n
    }))
  });
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  rpc.citations.mockImplementation(({ versionId }) =>
    Promise.resolve({
      sessionId: id,
      messageId: message.id,
      versionId,
      citations: [
        {
          marker: 1,
          sourceId: null,
          sourceName: `evidence ${versionId}`,
          anchor: { type: 'authored' },
          quote: `quote ${versionId}`
        }
      ]
    })
  );
  mount(<History id={id} />);
  await waitFor(() =>
    expect(rpc.citations).toHaveBeenCalledWith({
      sessionId: id,
      messageId: message.id,
      versionId: 63n
    })
  );
  expect(screen.getAllByText('SessionVersions', { selector: 'summary' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'SessionVersions' })).toBeNull();
  fireEvent.click(screen.getByText('SessionVersions', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'ReaderVersion 1' }));
  await waitFor(() =>
    expect(rpc.citations).toHaveBeenCalledWith({
      sessionId: id,
      messageId: message.id,
      versionId: 62n
    })
  );
  expect(await screen.findByText('quote 62')).toBeInTheDocument();
  expect(screen.queryByText('quote 63')).not.toBeInTheDocument();
});

it('removes cached exact picker content after a failed refresh and retries the same version', async () => {
  rpc.materials.mockResolvedValue({ items: [summary()], nextCursor: null });
  const client = cache();
  mount(<SelectionPanel id={id} />, client);
  await openSection('SessionSelection');
  fireEvent.click(await screen.findByText('Material 41 · ReaderVersion 2'));
  expect(await screen.findByRole('button', { name: 'SessionUseBlock · b0' })).toBeEnabled();
  const versionId = summary().version.id;
  rpc.document.mockRejectedValue(new StudyError('not_found', 'Retired'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: exactDocumentOptions(versionId).queryKey });
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'SessionUseBlock · b0' })).toBeNull()
  );
  expect(screen.queryByRole('button', { name: 'SessionUseWhole' })).toBeNull();
  expect(client.getQueryData(exactDocumentOptions(versionId).queryKey)).toBeDefined();
  rpc.document.mockImplementation(({ id: requested }) => exactDocument(requested));
  await act(async () => {
    await client.refetchQueries({ queryKey: exactDocumentOptions(versionId).queryKey });
  });
  expect(await screen.findByRole('button', { name: 'SessionUseBlock · b0' })).toBeEnabled();
  expect(rpc.document.mock.calls.every(([input]) => input.id === versionId)).toBe(true);
});

it('hides captured instructions after a failed exact-context read while retaining retry identity', async () => {
  const client = cache();
  mount(<CapturedContext requestId="capture-1" />, client);
  expect(await screen.findByText('Clarify')).toBeVisible();
  rpc.context.mockRejectedValue(new StudyError('not_found', 'Retired context'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: contextOptions('capture-1').queryKey });
  });
  await waitFor(() => expect(screen.queryByText('Clarify')).toBeNull());
  expect(client.getQueryData(contextOptions('capture-1').queryKey)).toBeDefined();
  expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1')).toBe(true);
  const retained = client.getQueryData(contextOptions('capture-1').queryKey);
  rpc.context.mockResolvedValue(retained);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Clarify')).toBeVisible();
  expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1')).toBe(true);
});

it('hides cached reply provenance on failure and recovers the same exact reply and capture', async () => {
  const message = Schema.decodeUnknownSync(chatMessageSchema)({
    id: 61n,
    sessionId: id,
    role: 'assistant',
    threadRoot: null,
    replyTo: 60n,
    activeVersionId: 63n,
    recordingId: null,
    recordingMs: null,
    recordedIn: null,
    createdAt: 1n,
    parts: [],
    citations: [],
    versions: [
      {
        id: 63n,
        number: 1n,
        origin: 'answer',
        status: 'complete',
        text: 'Retained reply',
        basedOn: null,
        instruction: null,
        createdAt: 1n
      }
    ]
  });
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  rpc.provenance.mockResolvedValue({ state: 'available', requestId: 'capture-1' });
  const client = cache();
  mount(<History id={id} />, client);
  fireEvent.click(await screen.findByText('SessionContextUsed', { selector: 'summary' }));
  expect(await screen.findByText('Clarify')).toBeVisible();
  expect(screen.queryByText('SessionVersions', { selector: 'summary' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'SessionVersions' })).toBeNull();
  rpc.provenance.mockRejectedValue(new StudyError('not_found', 'Retired reply context'));
  const options = provenanceOptions(id, message.id, message.activeVersionId!);
  await act(async () => {
    await client.invalidateQueries({ queryKey: options.queryKey });
  });
  await waitFor(() => expect(screen.queryByText('Clarify')).toBeNull());
  expect(screen.getByText('SessionReadUnavailable')).toBeVisible();
  expect(client.getQueryData(options.queryKey)).toEqual({
    state: 'available',
    requestId: 'capture-1'
  });
  expect(screen.getByText('Retained reply')).toBeVisible();
  rpc.provenance.mockResolvedValue({ state: 'available', requestId: 'capture-1' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Clarify')).toBeVisible();
  expect(
    rpc.provenance.mock.calls.every(
      ([input]) => input.sessionId === id && input.messageId === 61n && input.versionId === 63n
    )
  ).toBe(true);
  expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1')).toBe(true);
});

it('suppresses cached picker controls after exact version failure and preserves unsaved selection through recovery', async () => {
  rpc.materials.mockResolvedValue({ items: [summary()], nextCursor: null });
  const client = cache();
  mount(<SelectionPanel id={id} />, client);
  await openSection('SessionSelection');
  fireEvent.click(await screen.findByText('Material 41 · ReaderVersion 2'));
  fireEvent.click(await screen.findByRole('button', { name: 'SessionUseBlock · b0' }));
  const unsaved = client.getQueryData(draftKey);
  expect(unsaved).toBeDefined();
  const versionId = summary().version.id;
  rpc.version.mockRejectedValue(new StudyError('not_found', 'Retired version'));
  const key = versionOptions(versionId).queryKey;
  await act(async () => {
    await client.invalidateQueries({ queryKey: key });
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'SessionUseBlock · b0' })).toBeNull()
  );
  expect(screen.queryByRole('button', { name: 'SessionUseWhole' })).toBeNull();
  expect(client.getQueryData(key)).toBeDefined();
  expect(client.getQueryData(draftKey)).toEqual(unsaved);
  rpc.version.mockImplementation(({ id: requested }) => importedVersion(requested));
  await act(async () => {
    await client.refetchQueries({ queryKey: key });
  });
  expect(await screen.findByRole('button', { name: 'SessionUseBlock · b0' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(client.getQueryData(draftKey)).toEqual(unsaved);
  expect(rpc.version.mock.calls.every(([input]) => input.id === versionId)).toBe(true);
  expect(rpc.updateSelection).not.toHaveBeenCalled();
});

it('starts from a notebook draft, retaining later typing until creation is confirmed', async () => {
  const creation = deferred<typeof sessionSchema.Type>();
  rpc.create.mockReturnValue(creation.promise);
  rpc.session.mockResolvedValue({
    id,
    title: 'Notebook',
    projectIds: [],
    createdAt: 1n,
    updatedAt: 1n
  });
  rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
  const view = mount(<SessionWorkspace />);
  const input = await screen.findByRole('textbox', { name: 'SessionCompose' });
  fireEvent.change(input, { target: { value: 'Cell cycle lecture' } });
  fireEvent.click(screen.getByRole('button', { name: 'SessionNew' }));
  fireEvent.change(input, { target: { value: 'Cell cycle lecture — checkpoint question' } });
  await act(async () => creation.resolve({ id } as typeof sessionSchema.Type));
  await waitFor(() =>
    expect(view.client.getQueryData(['session-drafts', String(id), 'note'])).toMatchObject({
      text: 'Cell cycle lecture — checkpoint question'
    })
  );
  expect(rpc.create).toHaveBeenCalledTimes(1);
});
it('retains the start draft through an uncertain creation and remount', async () => {
  rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
  const first = mount(<SessionWorkspace />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'SessionCompose' }), {
    target: { value: 'Keep these notes' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'SessionNew' }));
  await screen.findByText('SessionCreationUncertain');
  first.unmount();
  mount(<SessionWorkspace />, first.client);
  expect(await screen.findByRole('textbox', { name: 'SessionCompose' })).toHaveValue(
    'Keep these notes'
  );
  expect(screen.getByRole('button', { name: 'SessionNew' })).toBeDisabled();
  expect(rpc.create).toHaveBeenCalledTimes(1);
});

it('replaces a failed session landing page with the shared error state and recovers on retry', async () => {
  rpc.sessions.mockRejectedValue(new StudyError('transient', 'Offline'));
  mount(<SessionWorkspace />);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { name: 'SessionReadErrorTitle' })).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'SessionCompose' })).not.toBeInTheDocument();
  rpc.sessions.mockResolvedValue({ items: [], next: null });
  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('textbox', { name: 'SessionCompose' })).toBeVisible();
});

it('fences repeated start shortcuts before the creation receipt arrives', async () => {
  rpc.create.mockReturnValue(new Promise(() => {}));
  mount(<SessionWorkspace />);
  const input = await screen.findByRole('textbox', { name: 'SessionCompose' });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'SessionNew' })).toBeDisabled();
});

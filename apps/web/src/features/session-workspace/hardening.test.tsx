import { sessionSelectionSchema } from '@study/contracts/conversations/context';
import { sessionDeletionSchema } from '@study/contracts/conversations/deletion';
import { chatMessageSchema, sessionSchema } from '@study/contracts/conversations/schemas';
import { transformSnapshotSchema } from '@study/contracts/documents/transform';
import { StudyError } from '@study/contracts/errors';
import { projectIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { projectSchema } from '@study/contracts/projects/schemas';
import { blockIdSchema } from '@study/contracts/sources/schemas';
import { executionSchema } from '@study/contracts/workflows/schemas';
import { testStable } from '@study/testing/vitest';
import { toastManager } from '@study/ui/toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  stringifySearchWith,
  RouterProvider
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { authoredDocument } from '../document-editing/test-support';
import { deferred } from '../material-library/test/support';
import { startDraftKey } from './start-drafts.queries';

const pickerDocument = (versionId = 102n) => {
  const value = authoredDocument(41n, 'Historical extraction', versionId);

  return {
    ...value,
    title: 'Material 41',
    version: {
      ...value.version!,
      number: versionId === 101n ? 1n : 2n,
      document: {
        ...value.version!.document,
        blocks: value.version!.document.blocks.map((block) => ({
          ...block,
          id: Schema.decodeUnknownSync(blockIdSchema)('b0')
        }))
      }
    }
  };
};

import { attachmentKey } from './attachments';
import { SessionDeleteDialog } from './deletion';
import { History, CapturedContext } from './history';
import * as workspaceQueries from './session-workspace.queries';
import {
  executionOptions,
  contextOptions,
  provenanceOptions,
  generationOptions,
  sessionPagesOptions
} from './session-workspace.queries';
import { Transformation } from './transformation';
import { SessionWorkspace } from './workspace';

const rpc = vi.hoisted(() => ({
  session: vi.fn(),
  projects: vi.fn(),
  remove: vi.fn(),
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

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
}));
vi.mock('#web/lib/study-client/client.ts', async () => {
  const { Effect } = await import('effect');
  const call = (handler: (input: unknown) => unknown) => (input: unknown) =>
    Effect.tryPromise({ try: () => Promise.resolve(handler(input)), catch: (error) => error });

  return {
    studyClient: Effect.succeed({
      'conversations.session': call(rpc.session),
      'projects.projects': call(rpc.projects),
      'conversations.deleteSession': call(rpc.remove),
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
      'documents.transform': call(rpc.generation),
      'documents.retryTransform': call(rpc.retryGeneration),
      'documents.cancelTransform': call(rpc.cancel),
      'documents.documents': call(rpc.materials),
      'documents.version': call(rpc.version),
      'documents.versions': () => Effect.succeed({ items: [], nextCursor: null }),
      'documents.document': call(rpc.document),
      'sources.sources': () => Effect.succeed({ items: [], next: null }),
      'workflows.executions': call(rpc.executions)
    })
  };
});

const id = Schema.decodeUnknownSync(sessionIdSchema)(9007199254740993n);

const selection = (revision = 8n, targets: readonly unknown[] = []) =>
  Schema.decodeUnknownSync(sessionSelectionSchema)({ revision, targets });

const generation = (patch = {}) =>
  Schema.decodeUnknownSync(transformSnapshotSchema)({
    id: 'transform-1',
    title: 'Derivative',
    instruction: 'Clarify',
    contextRequestId: 'capture-1',
    operations: ['clarity'],
    sessionId: id,
    eventId: 'transform-1',
    errorKind: null,
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

function mount(children: ReactNode, client = cache(), search = '', path = '/') {
  const root = createRootRoute({
    validateSearch: (value) => value as { id?: string; project?: string },
    component: () => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
  const router = createRouter({
    routeTree: root,
    parseSearch: (value) => Object.fromEntries(new URLSearchParams(value)),
    stringifySearch: stringifySearchWith(String),
    history: createMemoryHistory({ initialEntries: [`${path}${search}`] })
  });

  return { client, router, ...render(<RouterProvider router={router} />) };
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
  rpc.projects.mockResolvedValue({ items: [], next: null });
  rpc.sessions.mockResolvedValue({ items: [], next: null });
  rpc.session.mockResolvedValue({
    id,
    title: 'Notebook',
    projectIds: [],
    createdAt: 1n,
    updatedAt: 1n
  });
  rpc.generations.mockResolvedValue({ items: [], next: null });
  rpc.citations.mockResolvedValue({ citations: [] });
  rpc.selection.mockResolvedValue(selection());
  rpc.executions.mockResolvedValue({ items: [], next: null });
  rpc.generation.mockResolvedValue(generation());
  rpc.thread.mockResolvedValue({ items: [], next: null });
  rpc.materials.mockResolvedValue({ items: [], nextCursor: null });
  rpc.version.mockImplementation(({ id }) => pickerDocument(id).version);
  rpc.document.mockImplementation(() => pickerDocument());
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
  vi.restoreAllMocks();

  for (const client of caches.splice(0)) client.clear();
});

testStable.each(['pending', 'failed', 'completed'] as const)(
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
    const view = mount(<SessionWorkspace id={id} />, cache(), '?project=42');

    if (status === 'failed') {
      fireEvent.click(await screen.findByRole('button', { name: 'SessionRetryDelete' }));
      await waitFor(() => expect(rpc.retryDeletion).toHaveBeenCalledWith({ id }));
      await screen.findByText('SessionDeleting');
    } else {
      await screen.findByText(status === 'pending' ? 'SessionDeleting' : 'SessionNotesTitle');

      if (status === 'completed') {
        expect(screen.queryByText('SessionDeleteHelp')).not.toBeInTheDocument();
        expect(await screen.findByRole('textbox', { name: 'SessionCompose' })).toBeEnabled();
        await waitFor(() => expect(view.router.state.location.pathname).toBe('/sessions'));
        expect(view.router.state.location.search).toEqual({ project: '42' });
      }
    }

    expect(rpc.deletion).toHaveBeenCalledWith({ id });
    expect(screen.queryByRole('button', { name: 'SessionAsk' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SessionConfirmDelete' })).not.toBeInTheDocument();
    expect(rpc.selection).not.toHaveBeenCalled();
  }
);

testStable(
  'requires successful list review and deliberate acknowledgment before another ambiguous create',
  async () => {
    rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
    const first = mount(<SessionWorkspace />);

    fireEvent.change(await openStarterComposer(), { target: { value: 'First capture' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
    await screen.findByText('SessionCreationUncertain');
    first.unmount();
    mount(<SessionWorkspace />, first.client);
    expect(await screen.findByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'SessionCreationReviewed' })
    ).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole('button', { name: 'SessionCreationReviewed' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!);
    fireEvent.click(await screen.findByRole('button', { name: 'SessionCreationReviewed' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
    );
    expect(rpc.create).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
    await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(2));
  }
);

testStable(
  'allows another create after a definite invalid-input rejection without replaying automatically',
  async () => {
    rpc.create.mockRejectedValue(new StudyError('invalid_input', 'Rejected before commit'));
    mount(<SessionWorkspace />);
    fireEvent.change(await openStarterComposer(), { target: { value: 'First capture' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled();
    expect(screen.queryByText('SessionCreationUncertain')).not.toBeInTheDocument();
    expect(rpc.create).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'persists an ambiguous retry key across remounts and waits for its exact execution before another retry',
  async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rpc.retryGeneration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBe(2));
    const original = rpc.retryGeneration.mock.calls[0]![0];

    first.unmount();
    const second = mount(<Transformation id={id} />, client);

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

      client.setQueryData(executionOptions('transform-1').queryKey, {
        items: [failed],
        next: null
      });
      client.setQueryData(executionOptions('transform-1', original.retryId).queryKey, {
        items: [failed],
        next: null
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rpc.retryGeneration).toHaveBeenCalledTimes(3));
    expect(rpc.retryGeneration.mock.calls[2]![0].retryId).not.toBe(original.retryId);
  }
);

testStable('keeps cancelled transforms terminal and offers a fresh transform instead', async () => {
  rpc.generation.mockResolvedValue(generation({ cancelled: true }));
  rpc.executions.mockResolvedValue({ items: [execution('old-failure')], next: null });
  const client = cache();

  seedTransform(client);
  mount(<Transformation id={id} />, client);
  await screen.findByText('SessionCancelledTransform');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'SessionCancel' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'SessionNewTransform' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionCreateDocument' })).toBeEnabled()
  );
  expect(rpc.retryGeneration).not.toHaveBeenCalled();
});

testStable(
  'invalidates cached Library and selection search once per committed publication across remounts',
  async () => {
    const client = cache();

    seedTransform(client);
    const libraryKey = ['documents', 'library', undefined];
    const searchKey = ['search', 'Derivative'];

    client.setQueryData(libraryKey, {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [undefined]
    });
    client.setQueryData(searchKey, { hits: [] });
    const first = mount(<Transformation id={id} />, client);

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
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ['documents'] });
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ['search'] });
    first.unmount();
    invalidations.mockClear();
    rpc.generation.mockResolvedValue(generation({ resultVersionId: 51n }));
    mount(<Transformation id={id} />, client);
    await waitFor(() => expect(rpc.generation).toHaveBeenCalledTimes(2));
    expect(invalidations).not.toHaveBeenCalledWith({ queryKey: ['documents'] });
  }
);

testStable('exposes operation toggle state and contextual version groups', async () => {
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

  const clarity = await screen.findByRole('button', { name: 'SessionOpClarity' });

  expect(clarity).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(clarity);
  await waitFor(() => expect(clarity).toHaveAttribute('aria-pressed', 'false'));
  const groups = await screen.findAllByRole('group', { name: /^SessionVersions/ });

  expect(groups).toHaveLength(2);
  expect(groups[0]!.getAttribute('aria-label')).not.toBe(groups[1]!.getAttribute('aria-label'));
  const group = within(groups[0]!);

  expect(group.getByRole('status')).toHaveTextContent('SessionVersionLatest');
  fireEvent.click(group.getByRole('button', { name: 'SessionPreviousVersion' }));
  expect(group.getByRole('status')).toHaveTextContent('1');
  expect(group.getByRole('button', { name: 'SessionPreviousVersion' })).toBeDisabled();
  expect(group.getByRole('button', { name: 'SessionNextVersion' })).toBeEnabled();
});

testStable.each([undefined, null, Schema.decodeUnknownSync(projectIdSchema)(9007199254740995n)])(
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

testStable(
  'uses the routed project filter before pagination and trusts the server page',
  async () => {
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
  }
);

testStable(
  'keeps global, projectless and membership pages in distinct query-cache entries',
  async () => {
    const client = cache();
    const project = Schema.decodeUnknownSync(projectIdSchema)(9007199254740995n);
    const filters = [undefined, null, project];

    for (const filter of filters)
      await client.fetchInfiniteQuery({ ...sessionPagesOptions(filter), staleTime: Infinity });

    expect(rpc.sessions).toHaveBeenCalledTimes(3);
    expect(client.getQueryCache().findAll({ queryKey: ['sessions', 'pages'] })).toHaveLength(3);
    expect(sessionPagesOptions().queryKey).toEqual(sessionPagesOptions(undefined).queryKey);
  }
);

testStable(
  'queries citations for the exact viewed historical version, with no active-version fallback',
  async () => {
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
    expect(screen.queryByText('SessionVersions', { selector: 'summary' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'SessionPreviousVersion' }));
    await waitFor(() =>
      expect(rpc.citations).toHaveBeenCalledWith({
        sessionId: id,
        messageId: message.id,
        versionId: 62n
      })
    );
    expect(await screen.findByText('quote 62')).toBeInTheDocument();
    expect(screen.queryByText('quote 63')).not.toBeInTheDocument();
  }
);

testStable(
  'hides captured instructions after a failed exact-context read while retaining retry identity',
  async () => {
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
  }
);

testStable(
  'opens work details from the menu and recovers the exact reply context after failure',
  async () => {
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
    const reply = await screen.findByText('Retained reply', { selector: 'p' });

    expect(rpc.provenance).not.toHaveBeenCalled();
    expect(screen.queryByText('SessionContextUsed')).toBeNull();
    fireEvent.contextMenu(reply, { button: 2, clientX: 80, clientY: 80 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SessionWorkDetails' }));
    expect(await screen.findByRole('dialog', { name: 'SessionWorkDetails' })).toBeVisible();
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
    expect(screen.getByText('Retained reply', { selector: 'p' })).toBeVisible();
    rpc.provenance.mockResolvedValue({ state: 'available', requestId: 'capture-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Clarify')).toBeVisible();
    expect(
      rpc.provenance.mock.calls.every(
        ([input]) => input.sessionId === id && input.messageId === 61n && input.versionId === 63n
      )
    ).toBe(true);
    expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(client.getQueryCache().find({ queryKey: options.queryKey })?.getObserversCount()).toBe(
        0
      )
    );
    await waitFor(() => expect(reply.closest('[tabindex="0"]')).toHaveFocus());
  }
);

testStable(
  'starts from a notebook draft, retaining later typing until creation is confirmed',
  async () => {
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
    const input = await openStarterComposer();

    fireEvent.change(input, { target: { value: 'Cell cycle lecture' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
    fireEvent.change(input, { target: { value: 'Cell cycle lecture — checkpoint question' } });
    await act(async () => creation.resolve({ id } as typeof sessionSchema.Type));
    await waitFor(() =>
      expect(view.client.getQueryData(startDraftKey())).toBe(
        'Cell cycle lecture — checkpoint question'
      )
    );
    expect(rpc.create).toHaveBeenCalledExactlyOnceWith({
      project: undefined,
      initialMessage: { text: 'Cell cycle lecture', sourceIds: [] }
    });
  }
);

testStable('retains the start draft through an uncertain creation and remount', async () => {
  rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
  const first = mount(<SessionWorkspace />);

  fireEvent.change(await openStarterComposer(), {
    target: { value: 'Keep these notes' }
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await screen.findByText('SessionCreationUncertain');
  first.unmount();
  mount(<SessionWorkspace />, first.client);
  expect(await openStarterComposer()).toHaveValue('Keep these notes');
  expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
  expect(rpc.create).toHaveBeenCalledTimes(1);
});

testStable(
  'replaces a failed session landing page with the shared error state and recovers on retry',
  async () => {
    rpc.sessions.mockRejectedValue(new StudyError('transient', 'Offline'));
    mount(<SessionWorkspace />);
    const alert = await screen.findByRole('alert');

    expect(within(alert).getByRole('heading', { name: 'SessionReadErrorTitle' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'SessionCompose' })).not.toBeInTheDocument();
    rpc.sessions.mockResolvedValue({ items: [], next: null });
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await openStarterComposer()).toBeVisible();
  }
);

testStable('fences repeated start shortcuts before the creation receipt arrives', async () => {
  rpc.create.mockReturnValue(new Promise(() => {}));
  mount(<SessionWorkspace />);
  const input = await openStarterComposer();

  fireEvent.change(input, { target: { value: 'First capture' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
  );
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
});

testStable(
  'hands starter files to the confirmed session once and creates in the routed subject',
  async () => {
    const project = Schema.decodeUnknownSync(projectIdSchema)(9007199254740995n);
    const creation = deferred<typeof sessionSchema.Type>();

    rpc.create.mockReturnValue(creation.promise);
    rpc.session.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [project],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const upload = vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockResolvedValue({ id: 44n } as Awaited<ReturnType<typeof workspaceQueries.uploadSource>>);
    const view = mount(<SessionWorkspace />, cache(), `?project=${project}`);
    const file = new File(['Cell cycle'], 'lecture.txt', { type: 'text/plain' });

    await openStarterComposer();
    fireEvent.change(await screen.findByLabelText('SessionAttachFiles'), {
      target: { files: [file] }
    });
    expect(await screen.findByText('lecture.txt')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
    await waitFor(() =>
      expect(rpc.create).toHaveBeenCalledWith({
        project,
        initialMessage: { text: '', sourceIds: [44n] }
      })
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0]).toBe(file);
    await act(async () => creation.resolve({ id } as typeof sessionSchema.Type));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(view.client.getQueryData([...startDraftKey(String(project)), 'files'])).toEqual([]);
  }
);

testStable('retains selected files across an uncertain create and starter remount', async () => {
  rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
  vi.spyOn(workspaceQueries, 'uploadSource').mockResolvedValue({ id: 44n } as Awaited<
    ReturnType<typeof workspaceQueries.uploadSource>
  >);
  const first = mount(<SessionWorkspace />);
  const file = new File(['Retain me'], 'notes.txt', { type: 'text/plain' });

  await openStarterComposer();
  fireEvent.change(await screen.findByLabelText('SessionAttachFiles'), {
    target: { files: [file] }
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await screen.findByText('SessionCreationUncertain');
  first.unmount();
  mount(<SessionWorkspace />, first.client);
  expect(await screen.findByText('notes.txt')).toBeVisible();
  expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
  expect(rpc.create).toHaveBeenCalledTimes(1);
});

testStable(
  'keeps the active composer mounted while a missing deletion receipt is refreshed',
  async () => {
    rpc.session.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<SessionWorkspace id={id} />);
    const input = await screen.findByRole('textbox', { name: 'SessionCompose' });

    fireEvent.change(input, { target: { value: 'Keep writing during refresh' } });
    const key = workspaceQueries.deletionOptions(id, true).queryKey;

    await waitFor(() => expect(view.client.isFetching({ queryKey: key })).toBe(0));
    expect(view.client.getQueryData(key)).toBeNull();

    const receipt = deferred<void>();

    rpc.deletion.mockImplementation(async () => {
      await receipt.promise;

      throw new StudyError('not_found', 'Still no deletion');
    });
    let refresh: Promise<void> = Promise.resolve();

    await act(async () => {
      refresh = view.client.refetchQueries({ queryKey: key });
    });
    await waitFor(() => expect(view.client.isFetching({ queryKey: key })).toBe(1));
    expect(screen.getByRole('textbox', { name: 'SessionCompose' })).toBe(input);
    expect(input).toHaveValue('Keep writing during refresh');

    await act(async () => {
      receipt.resolve(undefined);
      await refresh;
    });
    expect(view.client.getQueryData(key)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'SessionCompose' })).toBe(input);
    expect(input).toHaveValue('Keep writing during refresh');
    const reads = rpc.deletion.mock.calls.length;

    await act(async () => {});
    expect(rpc.deletion).toHaveBeenCalledTimes(reads);
  }
);

testStable(
  'blocks editing and file drops after a failed deletion refresh despite a cached missing receipt',
  async () => {
    rpc.session.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const upload = vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockReturnValue(new Promise(() => {}));
    const view = mount(<SessionWorkspace id={id} />);
    const input = await screen.findByRole('textbox', { name: 'SessionCompose' });

    fireEvent.change(input, { target: { value: 'Retained while status is unknown' } });
    const key = workspaceQueries.deletionOptions(id, true).queryKey;

    await waitFor(() => expect(view.client.isFetching({ queryKey: key })).toBe(0));
    rpc.deletion.mockRejectedValue(new StudyError('transient', 'Receipt read unavailable'));
    await act(async () => {
      await view.client.refetchQueries({ queryKey: key });
    });
    expect(view.client.getQueryData(key)).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'SessionCompose' })).toBeNull()
    );
    fireEvent.drop(view.container.querySelector('.session-canvas')!, {
      dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
    });
    expect(upload).not.toHaveBeenCalled();
    expect(view.client.getQueryData(attachmentKey(id))).toEqual([]);
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    await act(async () => {
      await view.client.refetchQueries({ queryKey: key });
    });
    expect(await screen.findByRole('textbox', { name: 'SessionCompose' })).toHaveValue(
      'Retained while status is unknown'
    );
  }
);

testStable(
  'withdraws delete confirmation after a failed deletion refresh while keeping it during a pending refresh',
  async () => {
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<SessionDeleteDialog id={id} open onOpenChange={() => {}} />);
    const confirm = await screen.findByRole('button', { name: 'SessionConfirmDelete' });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DeleteConfirmationWord' } });
    await waitFor(() => expect(confirm).toBeEnabled());
    const key = workspaceQueries.deletionOptions(id, true).queryKey;

    await waitFor(() => expect(view.client.isFetching({ queryKey: key })).toBe(0));
    const receipt = deferred<void>();

    rpc.deletion.mockImplementation(async () => {
      await receipt.promise;

      throw new StudyError('transient', 'Read failed');
    });
    let refresh = Promise.resolve();

    await act(async () => {
      refresh = view.client.refetchQueries({ queryKey: key });
    });
    expect(screen.getByRole('button', { name: 'SessionConfirmDelete' })).toBe(confirm);
    await act(async () => {
      receipt.resolve(undefined);
      await refresh;
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionConfirmDelete' })).toBeDisabled()
    );
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(rpc.remove).not.toHaveBeenCalled();
  }
);

testStable('fences notebook drops while a shared deletion mutation is pending', async () => {
  rpc.session.mockResolvedValue({
    id,
    title: 'Notebook',
    projectIds: [],
    createdAt: 1n,
    updatedAt: 1n
  });
  rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
  rpc.remove.mockReturnValue(new Promise(() => {}));
  const upload = vi.spyOn(workspaceQueries, 'uploadSource').mockReturnValue(new Promise(() => {}));
  const view = mount(
    <>
      <SessionWorkspace id={id} />
      <SessionDeleteDialog id={id} open onOpenChange={() => {}} />
    </>
  );

  await waitFor(() =>
    expect(view.container.querySelector('.session-canvas textarea')).not.toBeNull()
  );
  const dialog = screen.getByRole('alertdialog');

  fireEvent.change(within(dialog).getByRole('textbox'), {
    target: { value: 'DeleteConfirmationWord' }
  });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'SessionConfirmDelete' }));
  await waitFor(() => expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
  await waitFor(() => expect(view.container.querySelector('.session-canvas textarea')).toBeNull());
  fireEvent.drop(view.container.querySelector('.session-canvas')!, {
    dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
  });
  expect(upload).not.toHaveBeenCalled();
  expect(view.client.getQueryData(attachmentKey(id))).toEqual([]);
});

testStable.each(['', '?project=9007199254740997'])(
  'uses the active session authoritative owner in the direct path breadcrumb %s',
  async (search) => {
    const owner = Schema.decodeUnknownSync(projectSchema)({
      id: 9007199254740995n,
      name: 'Biology',
      examOn: null,
      createdAt: 1n,
      updatedAt: 1n
    });
    const other = Schema.decodeUnknownSync(projectSchema)({
      id: 9007199254740997n,
      name: 'History',
      examOn: null,
      createdAt: 1n,
      updatedAt: 1n
    });

    rpc.projects.mockResolvedValue({ items: [owner, other], next: null });
    rpc.session.mockResolvedValue({
      id,
      title: 'Cell division',
      projectIds: [owner.id],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<SessionWorkspace id={id} />, cache(), search, `/sessions/${id}`);

    await screen.findByRole('heading', { name: 'Cell division' });
    const header = view.container.querySelector('.study-workspace-header')!;

    expect(within(header as HTMLElement).getByText('Biology')).toBeVisible();
    expect(within(header as HTMLElement).queryByText('History')).toBeNull();
    const context = await screen.findByRole('complementary', { name: 'SessionContextPanel' });

    expect(within(context).queryByRole('combobox')).toBeNull();
    expect(within(context).queryByRole('link', { name: 'SidebarLibrary' })).toBeNull();
  }
);

testStable(
  'keeps vertical session actions inside the default card and restores dialog focus and drafts',
  async () => {
    rpc.session.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<SessionWorkspace id={id} />);

    await screen.findByRole('button', { name: 'SessionTransform' });
    const panel = await screen.findByRole('complementary', { name: 'SessionContextPanel' });

    expect(screen.getAllByRole('button', { name: 'SessionTransform' })).toHaveLength(1);
    expect(within(panel).getByRole('button', { name: 'SessionArchived' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SessionSelection' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'SessionTransform' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'SessionDelete' })).toBeInTheDocument();
    expect(view.container.querySelector('.ui-workspace-dock .session-context-actions')).toBeNull();
    expect(screen.queryByText('SessionTools')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'SessionTransform' }));
    const dialog = await screen.findByRole('dialog', { name: 'SessionTransform' });
    const instruction = within(dialog).getByRole('textbox', { name: 'SessionInstructions' });

    fireEvent.change(instruction, { target: { value: 'Keep this instruction' } });
    instruction.focus();
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'SessionTransform' })).toBeNull()
    );
    expect(within(panel).getByRole('button', { name: 'SessionTransform' })).toHaveFocus();
    fireEvent.click(within(panel).getByRole('button', { name: 'SessionTransform' }));
    await screen.findByRole('dialog', { name: 'SessionTransform' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'SessionInstructions' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'SessionTransform' }));
    expect(
      within(await screen.findByRole('dialog', { name: 'SessionTransform' })).getByRole('textbox', {
        name: 'SessionInstructions'
      })
    ).toBe(instruction);
    expect(instruction).toHaveValue('Keep this instruction');
    expect(rpc.selection).toHaveBeenCalledWith({ sessionId: id });
  }
);

testStable(
  'retains the notebook edit fence after an uncertain deletion request and remount',
  async () => {
    rpc.session.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    rpc.remove.mockRejectedValue(new StudyError('transient', 'Deletion response lost'));
    const upload = vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockReturnValue(new Promise(() => {}));
    const view = mount(
      <>
        <SessionWorkspace id={id} />
        <SessionDeleteDialog id={id} open onOpenChange={() => {}} />
      </>
    );

    await waitFor(() =>
      expect(view.container.querySelector('.session-canvas textarea')).not.toBeNull()
    );
    const key = workspaceQueries.deletionOptions(id, true).queryKey;

    await waitFor(() => expect(view.client.isFetching({ queryKey: key })).toBe(0));
    rpc.deletion.mockReturnValue(new Promise(() => {}));
    const dialog = screen.getByRole('alertdialog');

    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'SessionConfirmDelete' }));
    await waitFor(() => expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
    await waitFor(() => expect(view.client.isMutating()).toBe(0));
    expect(view.container.querySelector('.session-canvas textarea')).toBeNull();
    fireEvent.drop(view.container.querySelector('.session-canvas')!, {
      dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
    });
    expect(upload).not.toHaveBeenCalled();
    view.unmount();
    const remounted = mount(<SessionWorkspace id={id} />, view.client);

    await act(async () => {});
    expect(remounted.container.querySelector('.session-canvas textarea')).toBeNull();
    expect(view.client.getQueryData(attachmentKey(id))).toEqual([]);
  }
);

testStable(
  'does not replay a deletion success notification when reopening a completed session',
  async () => {
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const completion = deferred<typeof sessionDeletionSchema.Type>();

    rpc.remove.mockReturnValue(completion.promise);
    const notify = vi.spyOn(toastManager, 'add');
    const view = mount(<SessionDeleteDialog id={id} open onOpenChange={() => {}} />);
    const confirm = await screen.findByRole('button', { name: 'SessionConfirmDelete' });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DeleteConfirmationWord' } });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(rpc.remove).toHaveBeenCalledTimes(1));
    view.unmount();
    const receipt = Schema.decodeUnknownSync(sessionDeletionSchema)({
      operationId: 'unobserved-completion',
      sessionId: id,
      status: 'completed',
      errorKind: null,
      attempt: 1,
      completedAt: 2n
    });

    await act(async () => completion.resolve(receipt));
    rpc.deletion.mockResolvedValue(receipt);
    mount(<SessionDeleteDialog id={id} open onOpenChange={() => {}} />, view.client);
    await screen.findByText('SessionDeleted');
    expect(notify).not.toHaveBeenCalled();
  }
);

testStable('announces completion once when deleting from the active workspace dialog', async () => {
  rpc.session.mockResolvedValue({
    id,
    title: 'Notebook',
    projectIds: [projectIdSchema.make(42n)],
    createdAt: 1n,
    updatedAt: 1n
  });
  rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
  const completion = deferred<typeof sessionDeletionSchema.Type>();

  rpc.remove.mockReturnValue(completion.promise);
  const notify = vi.spyOn(toastManager, 'add');
  const view = mount(<SessionWorkspace id={id} />);

  fireEvent.click(await screen.findByRole('button', { name: 'SessionDelete' }));
  const dialog = within(await screen.findByRole('alertdialog'));

  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'DeleteConfirmationWord' } });
  const confirm = dialog.getByRole('button', { name: 'SessionConfirmDelete' });

  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
  const receipt = Schema.decodeUnknownSync(sessionDeletionSchema)({
    sessionId: id,
    operationId: 'owned-workspace-delete',
    status: 'completed',
    errorKind: null,
    attempt: 1,
    completedAt: 2n
  });

  rpc.deletion.mockResolvedValue(receipt);
  await act(async () => completion.resolve(receipt));
  await screen.findByText('SessionNotesTitle');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: 'SessionDeleted', type: 'success' });
  await waitFor(() => expect(view.router.state.location.pathname).toBe('/sessions'));
  expect(view.router.state.location.search).toEqual({ project: '42' });
});

async function openStarterComposer() {
  const entry = await waitFor(
    () =>
      screen.queryByRole('textbox', { name: 'SessionCompose' }) ??
      screen.getByRole('button', { name: 'SessionStartWithNote' })
  );

  if (entry.tagName === 'BUTTON') fireEvent.click(entry);

  return screen.findByRole('textbox', { name: 'SessionCompose' });
}

testStable('ignores obsolete selection drafts when starting a session transformation', async () => {
  const client = cache();

  client.setQueryData(['session-drafts', String(id), 'selection'], selection());
  mount(<Transformation id={id} />, client);
  fireEvent.change(await screen.findByRole('textbox', { name: 'SessionOutputTitle' }), {
    target: { value: 'New summary' }
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionCreateDocument' })).toBeEnabled()
  );
});

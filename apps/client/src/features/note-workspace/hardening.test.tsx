import {
  StudyError,
  projectIdSchema,
  noteIdSchema,
  noteSelectionSchema,
  noteDeletionSchema,
  chatMessageSchema,
  noteSchema,
  transformSnapshotSchema,
  projectSchema,
  endpoints,
  blockIdSchema,
  executionSchema
} from '@study/contracts';
import { test } from '@study/testing';
import { toastManager } from '@study/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  stringifySearchWith,
  RouterProvider
} from '@tanstack/react-router';
import { Effect, Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from '../material-library/test/support';
import type * as __MockType5 from './attachments';
import type * as __MockType6 from './deletion';
import type * as __MockType7 from './history';
import type * as __MockType8 from './note-workspace.queries';
import type * as __MockType2 from './start-drafts.queries';
import type * as __MockType3 from './start.queries';
import type * as __MockType9 from './transformation';
import type * as __MockType4 from './transformation.queries';
import type * as __MockType10 from './workspace';

let authoredPage: typeof __MockType0.authoredPage;

let deferred: typeof __MockType1.deferred;

let startDraft: typeof __MockType2.startDraft;

let startFiles: typeof __MockType2.startFiles;

let startDraftKey: typeof __MockType2.startDraftKey;

let creationFlow: typeof __MockType3.creationFlow;

let transformDraft: typeof __MockType4.transformDraft;

function initializePickerPage() {
  return (versionId = 102n) => {
    const value = authoredPage(41n, 'Historical extraction', versionId);

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
}

let pickerPage: ReturnType<typeof initializePickerPage>;

let attachmentState: typeof __MockType5.attachmentState;

let NoteDeleteDialog: typeof __MockType6.NoteDeleteDialog;

let History: typeof __MockType7.History;

let CapturedContext: typeof __MockType7.CapturedContext;

let workspaceQueries: typeof __MockType8;

let Transformation: typeof __MockType9.Transformation;

let NoteWorkspace: typeof __MockType10.NoteWorkspace;

let rpc: ReturnType<typeof createMockState>['rpc'];

function testFixture(client: AtomRegistry.AtomRegistry) {
  return test.rpcHandlersTransport(
    {
      'notes.note': async (input) => ({
        title: 'Notebook',
        titleSource: 'user',
        archivedAt: null,
        projectIds: [],
        createdAt: 1n,
        updatedAt: 1n,
        ...(await rpc.note(input))
      }),
      'projects.projects': rpc.projects,
      'notes.deleteNote': async (input) => {
        const value = await rpc.remove(input);

        rpc.deletion.mockResolvedValue(value);

        return value;
      },
      'notes.noteGenerations': rpc.generations,
      'notes.messageVersionCitations': async (input) => ({
        ...Schema.decodeUnknownSync(
          Schema.toType(endpoints.notes.messageVersionCitations.rpc.payloadSchema)
        )(input),
        ...(await rpc.citations(input))
      }),
      'notes.replyVersion': rpc.provenance,
      'notes.noteDeletion': rpc.deletion,
      'notes.retryNoteDeletion': async (input) => {
        const value = await rpc.retryDeletion(input);

        rpc.deletion.mockResolvedValue(value);

        return value;
      },
      'notes.createUntitledNote': async (input) => ({
        title: 'Notebook',
        titleSource: 'user',
        archivedAt: null,
        projectIds: [],
        createdAt: 1n,
        updatedAt: 1n,
        ...(await rpc.create(input))
      }),
      'notes.notes': rpc.notes,
      'notes.noteSelection': rpc.selection,
      'notes.updateNoteSelection': rpc.updateSelection,
      'notes.inspectNoteContext': rpc.context,
      'notes.thread': rpc.thread,
      'pages.transform': rpc.generation,
      'pages.retryTransform': rpc.retryGeneration,
      'pages.cancelTransform': rpc.cancel,
      'pages.pages': rpc.materials,
      'pages.version': rpc.version,
      'pages.versions': () => Effect.succeed({ items: [], nextCursor: null }),
      'pages.page': rpc.document,
      'sources.sources': () => Effect.succeed({ items: [], next: null }),
      'workflows.executions': rpc.executions
    },
    client
  );
}

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

const selection = (revision = 8n, targets: readonly unknown[] = []) =>
  Schema.decodeUnknownSync(noteSelectionSchema)({ revision, targets });

const generation = (patch = {}) =>
  Schema.decodeUnknownSync(transformSnapshotSchema)({
    id: 'transform-1',
    title: 'Derivative',
    instruction: 'Clarify',
    contextRequestId: 'capture-1',
    operations: ['clarity'],
    noteId: id,
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
    configurationWaitReason: null,
    canCancel: false,
    createdAtMs: 1n,
    updatedAtMs: 2n
  });

const caches: AtomRegistry.AtomRegistry[] = [];

function cache() {
  const client = AtomRegistry.make();

  caches.push(client);

  return client;
}

const fixtures = new WeakMap<
  AtomRegistry.AtomRegistry,
  ReturnType<typeof test.rpcHandlersTransport>
>();

const notify = (client: AtomRegistry.AtomRegistry) =>
  fixtures.get(client)?.notify() ?? Promise.resolve([]);

function mount(children: ReactNode, client = cache(), search = '', path = '/') {
  const fixture = testFixture(client);

  fixtures.set(client, fixture);
  const Provider = fixture.wrapper;
  const root = createRootRoute({
    validateSearch: (value) => value as { id?: string; project?: string },
    component: () => <Provider>{children}</Provider>
  });
  const router = createRouter({
    routeTree: root,
    parseSearch: (value) => Object.fromEntries(new URLSearchParams(value)),
    stringifySearch: stringifySearchWith(String),
    history: createMemoryHistory({ initialEntries: [`${path}${search}`] })
  });

  return {
    client,
    router,
    notify: fixture.notify,
    ...test.render(<RouterProvider router={router} />)
  };
}

function seedTransform(client: AtomRegistry.AtomRegistry) {
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
  client.set(transformDraft(id), {
    title: 'Derivative',
    instruction: 'Clarify',
    operations: ['clarity'],
    requestId: 'transform-1',
    runs: [{ id: 'transform-1', contextId: 'capture-1' }]
  });
}

function createMockState(mock: test.Mock) {
  return {
    rpc: (() => ({
      note: mock.fn(),
      projects: mock.fn(),
      remove: mock.fn(),
      generations: mock.fn(),
      citations: mock.fn(),
      provenance: mock.fn(),
      deletion: mock.fn(),
      retryDeletion: mock.fn(),
      create: mock.fn(),
      notes: mock.fn(),
      selection: mock.fn(),
      updateSelection: mock.fn(),
      generation: mock.fn(),
      executions: mock.fn(),
      retryGeneration: mock.fn(),
      cancel: mock.fn(),
      context: mock.fn(),
      thread: mock.fn(),
      materials: mock.fn(),
      version: mock.fn(),
      document: mock.fn()
    }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  rpc = __mockState.rpc;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
  }));
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('../material-library/test/support');

  deferred = __mockModule1.deferred;
  const __mockModule2 = await import('./start-drafts.queries');

  startDraft = __mockModule2.startDraft;
  startFiles = __mockModule2.startFiles;
  startDraftKey = __mockModule2.startDraftKey;
  const __mockModule3 = await import('./start.queries');

  creationFlow = __mockModule3.creationFlow;
  const __mockModule4 = await import('./transformation.queries');

  transformDraft = __mockModule4.transformDraft;
  const __mockModule5 = await import('./attachments');

  attachmentState = __mockModule5.attachmentState;
  const __mockModule6 = await import('./deletion');

  NoteDeleteDialog = __mockModule6.NoteDeleteDialog;
  const __mockModule7 = await import('./history');

  History = __mockModule7.History;
  CapturedContext = __mockModule7.CapturedContext;
  const __mockModule8 = await import('./note-workspace.queries');

  workspaceQueries = __mockModule8;
  const __mockModule9 = await import('./transformation');

  Transformation = __mockModule9.Transformation;
  const __mockModule10 = await import('./workspace');

  NoteWorkspace = __mockModule10.NoteWorkspace;
  pickerPage = initializePickerPage();
});

test.beforeEach(() => {
  test.vi.resetAllMocks();
  rpc.projects.mockResolvedValue({ items: [], next: null });
  rpc.notes.mockResolvedValue({ items: [], next: null });
  rpc.note.mockResolvedValue({
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
  rpc.version.mockImplementation(({ id }) => pickerPage(id).version);
  rpc.document.mockImplementation(() => pickerPage());
  rpc.context.mockResolvedValue({
    requestId: 'capture-1',
    noteId: id,
    intentKey: 'capture-key',
    instruction: 'Clarify',
    preferences: {},
    selectionRevision: 8n,
    inputs: [],
    messages: [],
    excludedMessages: 0
  });
});
test.afterEach(() => {
  test.vi.restoreAllMocks();

  for (const client of caches.splice(0)) client.dispose();
});

test.stable.each(['pending', 'failed', 'completed'] as const)(
  'recovers a cold deleted page with a %s receipt',
  async (status) => {
    rpc.note.mockRejectedValue(new StudyError('not_found', 'Deleted'));
    const receipt = Schema.decodeUnknownSync(noteDeletionSchema)({
      noteId: id,
      operationId: 'delete-1',
      status,
      errorKind: status === 'failed' ? 'transient' : null,
      attempt: 1,
      completedAt: status === 'completed' ? 2n : null
    });

    rpc.deletion.mockResolvedValue(receipt);
    rpc.retryDeletion.mockResolvedValue({ ...receipt, status: 'pending', attempt: 2 });
    const view = mount(<NoteWorkspace id={id} />, cache(), '?project=42');

    if (status === 'failed') {
      test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteRetryDelete' }));
      await test.waitFor(() => test.expect(rpc.retryDeletion).toHaveBeenCalledWith({ id }));
      await test.screen.findByText('NoteDeleting');
    } else {
      await test.screen.findByText(status === 'pending' ? 'NoteDeleting' : 'NoteNotesTitle');

      if (status === 'completed') {
        test.expect(test.screen.queryByText('NoteDeleteHelp')).not.toBeInTheDocument();
        test.expect(await test.screen.findByRole('textbox', { name: 'NoteCompose' })).toBeEnabled();
        await test.waitFor(() => test.expect(view.router.state.location.pathname).toBe('/notes'));
        test.expect(view.router.state.location.search).toEqual({ project: '42' });
      }
    }

    test.expect(rpc.deletion).toHaveBeenCalledWith({ id });
    test.expect(test.screen.queryByRole('button', { name: 'NoteAsk' })).not.toBeInTheDocument();
    test
      .expect(test.screen.queryByRole('button', { name: 'NoteConfirmDelete' }))
      .not.toBeInTheDocument();
    test.expect(rpc.selection).not.toHaveBeenCalled();
  }
);

test.stable(
  'requires successful list review and deliberate acknowledgment before another ambiguous create',
  async () => {
    rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
    const first = mount(<NoteWorkspace />);

    test.fireEvent.change(await openStarterComposer(), { target: { value: 'First capture' } });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    await test.screen.findByText('NoteCreationUncertain');
    first.unmount();
    mount(<NoteWorkspace />, first.client);
    test.expect(await test.screen.findByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    test
      .expect(test.screen.queryByRole('button', { name: 'NoteCreationReviewed' }))
      .not.toBeInTheDocument();
    await test.waitFor(() => test.expect(rpc.notes.mock.calls.length).toBeGreaterThanOrEqual(2));
    await test.waitFor(() =>
      test.expect(test.screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!).toBeEnabled()
    );
    rpc.notes.mockRejectedValueOnce(new StudyError('transient', 'Offline'));
    test.fireEvent.click(test.screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!);
    await test.waitFor(() => test.expect(rpc.notes.mock.calls.length).toBeGreaterThanOrEqual(3));
    await test.waitFor(() =>
      test.expect(test.screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!).toBeEnabled()
    );
    test
      .expect(test.screen.queryByRole('button', { name: 'NoteCreationReviewed' }))
      .not.toBeInTheDocument();
    test.fireEvent.click(test.screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!);
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteCreationReviewed' }));
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
    );
    test.expect(rpc.create).toHaveBeenCalledTimes(1);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    await test.waitFor(() => test.expect(rpc.create).toHaveBeenCalledTimes(2));
  }
);

test.stable(
  'allows another create after a definite invalid-input rejection without replaying automatically',
  async () => {
    rpc.create.mockRejectedValue(new StudyError('invalid_input', 'Rejected before commit'));
    mount(<NoteWorkspace />);
    test.fireEvent.change(await openStarterComposer(), { target: { value: 'First capture' } });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    await test.screen.findByRole('alert');
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled();
    test.expect(test.screen.queryByText('NoteCreationUncertain')).not.toBeInTheDocument();
    test.expect(rpc.create).toHaveBeenCalledTimes(1);
  }
);

test.stable(
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

    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
    await test.waitFor(() => test.expect(rpc.retryGeneration).toHaveBeenCalledTimes(1));
    await test.waitFor(() =>
      test.expect(test.screen.getAllByRole('button', { name: 'Retry' }).length).toBe(2)
    );
    const original = rpc.retryGeneration.mock.calls[0]![0];

    first.unmount();
    const second = mount(<Transformation id={id} />, client);

    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
    await test.waitFor(() => test.expect(rpc.retryGeneration).toHaveBeenCalledTimes(2));
    test.expect(rpc.retryGeneration.mock.calls[1]![0]).toEqual(original);
    await test.waitFor(() =>
      test.expect(rpc.executions).toHaveBeenCalledWith({
        correlationId: 'transform-1',
        eventId: original.retryId,
        limit: 30
      })
    );
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    );
    second.unmount();
    mount(<Transformation id={id} />, client);
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    );
    await test.waitFor(() => test.expect(rpc.executions).toHaveBeenCalled());
    // A newer unrelated failure must not authorize another retry of this attempt.
    await test.act(async () => {
      rpc.executions.mockImplementation(({ eventId }) => ({
        items: eventId ? [] : [execution('unrelated')],
        next: null
      }));
      await notify(client);
    });
    test.expect(test.screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    await test.act(async () => {
      const failed = execution('retry-failure');

      rpc.executions.mockResolvedValue({ items: [failed], next: null });
      await notify(client);
    });
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
    await test.waitFor(() => test.expect(rpc.retryGeneration).toHaveBeenCalledTimes(3));
    test.expect(rpc.retryGeneration.mock.calls[2]![0].retryId).not.toBe(original.retryId);
  }
);

test.stable(
  'keeps cancelled transforms terminal and offers a fresh transform instead',
  async () => {
    rpc.generation.mockResolvedValue(generation({ cancelled: true }));
    rpc.executions.mockResolvedValue({ items: [execution('old-failure')], next: null });
    const client = cache();

    seedTransform(client);
    mount(<Transformation id={id} />, client);
    await test.screen.findByText('NoteCancelledTransform');
    test.expect(test.screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    test.expect(test.screen.queryByRole('button', { name: 'NoteCancel' })).not.toBeInTheDocument();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteNewTransform' }));
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    test.expect(rpc.retryGeneration).not.toHaveBeenCalled();
  }
);

test.stable('exposes operation toggle state and contextual version groups', async () => {
  const client = cache();
  const message = (messageId: bigint) =>
    Schema.decodeUnknownSync(chatMessageSchema)({
      id: messageId,
      noteId: id,
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

  const clarity = await test.screen.findByRole('button', { name: 'NoteOpClarity' });

  test.expect(clarity).toHaveAttribute('aria-pressed', 'true');
  test.fireEvent.click(clarity);
  await test.waitFor(() => test.expect(clarity).toHaveAttribute('aria-pressed', 'false'));
  const groups = await test.screen.findAllByRole('group', { name: /^NoteVersions/ });

  test.expect(groups).toHaveLength(2);
  test
    .expect(groups[0]!.getAttribute('aria-label'))
    .not.toBe(groups[1]!.getAttribute('aria-label'));
  const group = test.within(groups[0]!);

  test.expect(group.getByRole('status')).toHaveTextContent('NoteVersionLatest');
  test.fireEvent.click(group.getByRole('button', { name: 'NotePreviousVersion' }));
  test.expect(group.getByRole('status')).toHaveTextContent('1');
  test.expect(group.getByRole('button', { name: 'NotePreviousVersion' })).toBeDisabled();
  test.expect(group.getByRole('button', { name: 'NoteNextVersion' })).toBeEnabled();
});

test.stable(
  'uses the routed project filter before pagination and trusts the server page',
  async () => {
    const project = Schema.decodeUnknownSync(projectIdSchema)(9007199254740995n);
    const cursor = { updatedAt: 2n, id };
    const item = Schema.decodeUnknownSync(noteSchema)({
      id,
      title: 'Server-selected note',
      titleSource: 'user',
      archivedAt: null,
      projectIds: [project],
      createdAt: 1n,
      updatedAt: 2n
    });

    rpc.notes
      .mockResolvedValueOnce({ items: [item], next: cursor })
      .mockResolvedValue({ items: [], next: null });
    const client = cache();

    client.set(creationFlow, { uncertain: true });
    mount(<NoteWorkspace />, client, `?project=${project}`);
    test.expect(await test.screen.findByText('Server-selected note')).toBeInTheDocument();
    test.expect(rpc.notes).toHaveBeenCalledWith({ limit: 30, project, before: undefined });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'LibraryMore' }));
    await test.waitFor(() =>
      test.expect(rpc.notes).toHaveBeenCalledWith({ limit: 60, project, before: undefined })
    );
  }
);

test.stable(
  'renders question and answer in one entry and keeps the question toggle beside deletion',
  async () => {
    const message = Schema.decodeUnknownSync(chatMessageSchema)({
      id: 61n,
      noteId: id,
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
      question: {
        kind: 'question',
        origin: 'manual',
        versionId: 62n,
        answerMessageId: 61n,
        answerVersionId: 63n
      },
      versions: [
        {
          id: 62n,
          number: 1n,
          origin: 'typed',
          status: 'complete',
          text: 'Why does ice float?',
          basedOn: null,
          instruction: null,
          createdAt: 1n
        },
        {
          id: 63n,
          number: 2n,
          origin: 'answer',
          status: 'complete',
          text: '**Question**\n\nWhy does ice float?\n\n**Answer**\n\nIce is less dense than water.',
          basedOn: 62n,
          instruction: null,
          createdAt: 1n
        }
      ]
    });

    rpc.thread.mockResolvedValue({ items: [message], next: null });
    mount(<History id={id} />);
    test.expect(await test.screen.findByText('Ice is less dense than water.')).toBeVisible();
    test.expect(test.screen.queryByText('Question', { selector: 'strong' })).toBeNull();
    test.expect(test.screen.getByText('NoteAnswer')).toBeVisible();
    const toolbar = test.within(test.screen.getByRole('group', { name: 'NoteItemActions' }));

    test.expect(toolbar.getByRole('button', { name: 'NoteMarkAsNote' })).toBeVisible();
    test.expect(toolbar.getByRole('button', { name: 'NoteDeleteItem' })).toBeVisible();
    test.expect(test.screen.queryByRole('button', { name: 'NoteViewAnswer' })).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NotePreviousVersion' }));
    test.expect(test.screen.getByText('Why does ice float?')).toBeVisible();
    test.expect(test.screen.queryByText('Ice is less dense than water.')).toBeNull();
  }
);

function citationMessage() {
  return Schema.decodeUnknownSync(chatMessageSchema)({
    id: 61n,
    noteId: id,
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
}

test.stable.each(['pending', 'writing'] as const)(
  'keeps %s rewrite content and citation evidence on the displayed parent version',
  async (status) => {
    const saved = citationMessage();
    const message = Schema.decodeUnknownSync(chatMessageSchema)({
      ...saved,
      versions: saved.versions.map((version, index) =>
        index === 0
          ? { ...version, text: 'Original explanation [1].' }
          : { ...version, status, origin: 'summarize', text: '', basedOn: saved.versions[0]!.id }
      )
    });

    rpc.thread.mockResolvedValue({ items: [message], next: null });
    rpc.provenance.mockResolvedValue({ state: 'available', requestId: 'pending-rewrite' });
    rpc.citations.mockImplementation(({ versionId }) =>
      Promise.resolve({
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

    test.expect(await test.screen.findByText(/Original explanation/)).toBeVisible();
    await test.waitFor(() =>
      test.expect(rpc.citations).toHaveBeenCalledWith({
        noteId: id,
        messageId: message.id,
        versionId: 62n
      })
    );
    test
      .expect(rpc.citations)
      .not.toHaveBeenCalledWith(test.expect.objectContaining({ versionId: 63n }));
    await test.waitFor(() =>
      test
        .expect(rpc.provenance)
        .toHaveBeenCalledWith(test.expect.objectContaining({ versionId: 63n }))
    );
    test.fireEvent.click(
      (await test.screen.findAllByRole('button', { name: 'NoteOpenCitation' }))[0]!
    );
    test.expect(await test.screen.findByText('quote 62')).toBeVisible();
    test.expect(test.screen.queryByText('quote 63')).not.toBeInTheDocument();
  }
);

test.stable(
  'queries citations for the exact viewed historical version, with no active-version fallback',
  async () => {
    const message = citationMessage();

    rpc.thread.mockResolvedValue({ items: [message], next: null });
    rpc.citations.mockImplementation(({ versionId }) =>
      Promise.resolve({
        noteId: id,
        messageId: message.id,
        versionId,
        citations: [
          {
            marker: 1,
            sourceId: null,
            sourceName: `evidence ${versionId}`,
            input: { kind: 'source', sourceId: 10n, revision: 1n, snapshotId: 16n },
            anchor: { type: 'authored' },
            quote: `quote ${versionId}`
          }
        ]
      })
    );
    mount(<History id={id} />);
    await test.waitFor(() =>
      test.expect(rpc.citations).toHaveBeenCalledWith({
        noteId: id,
        messageId: message.id,
        versionId: 63n
      })
    );
    test.expect(test.screen.queryByText('NoteVersions', { selector: 'summary' })).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NotePreviousVersion' }));
    await test.waitFor(() =>
      test.expect(rpc.citations).toHaveBeenCalledWith({
        noteId: id,
        messageId: message.id,
        versionId: 62n
      })
    );
    test.expect(test.screen.queryByText('quote 62')).toBeNull();
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteOpenCitation' }));
    test.expect(await test.screen.findByText('quote 62')).toBeVisible();
    test
      .expect(test.screen.getByRole('link', { name: 'NoteCitationTakeMeThere' }))
      .toHaveAttribute('href', '/sources/10?sourceRevision=1&sourceSnapshot=16');
    test.expect(test.screen.queryByText('quote 63')).not.toBeInTheDocument();
  }
);

test.stable(
  'hides captured instructions after a failed exact-context read while retaining retry identity',
  async () => {
    const client = cache();

    mount(<CapturedContext requestId="capture-1" />, client);
    test.expect(await test.screen.findByText('Clarify')).toBeVisible();
    rpc.context.mockRejectedValue(new StudyError('not_found', 'Retired context'));
    await test.act(async () => {
      await notify(client);
    });
    await test.waitFor(() => test.expect(test.screen.queryByText('Clarify')).toBeNull());
    test
      .expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1'))
      .toBe(true);
    const retained = {
      requestId: 'capture-1',
      noteId: id,
      intentKey: 'capture-key',
      instruction: 'Clarify',
      preferences: {},
      selectionRevision: 8n,
      inputs: [],
      messages: [],
      excludedMessages: 0
    };

    rpc.context.mockResolvedValue(retained);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    test.expect(await test.screen.findByText('Clarify')).toBeVisible();
    test
      .expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1'))
      .toBe(true);
  }
);

test.stable(
  'opens work details from the menu and recovers the exact reply context after failure',
  async () => {
    const message = Schema.decodeUnknownSync(chatMessageSchema)({
      id: 61n,
      noteId: id,
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
    const reply = await test.screen.findByText('Retained reply', { selector: 'p' });

    test.expect(rpc.provenance).not.toHaveBeenCalled();
    test.expect(test.screen.queryByText('NoteContextUsed')).toBeNull();
    test.fireEvent.contextMenu(reply, { button: 2, clientX: 80, clientY: 80 });
    test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'NoteWorkDetails' }));
    test.expect(await test.screen.findByRole('dialog', { name: 'NoteWorkDetails' })).toBeVisible();
    test.expect(await test.screen.findByText('Clarify')).toBeVisible();
    test.expect(test.screen.queryByText('NoteVersions', { selector: 'summary' })).toBeNull();
    test.expect(test.screen.queryByRole('button', { name: 'NoteVersions' })).toBeNull();
    rpc.provenance.mockRejectedValue(new StudyError('not_found', 'Retired reply context'));

    await test.act(async () => {
      await notify(client);
    });
    await test.waitFor(() => test.expect(test.screen.queryByText('Clarify')).toBeNull());
    test.expect(test.screen.getByText('NoteReadUnavailable')).toBeVisible();
    test.expect(test.screen.getByText('Retained reply', { selector: 'p' })).toBeVisible();
    rpc.provenance.mockResolvedValue({ state: 'available', requestId: 'capture-1' });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    test.expect(await test.screen.findByText('Clarify')).toBeVisible();
    test
      .expect(
        rpc.provenance.mock.calls.every(
          ([input]) => input.noteId === id && input.messageId === 61n && input.versionId === 63n
        )
      )
      .toBe(true);
    test
      .expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1'))
      .toBe(true);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Close' }));
    await test.waitFor(() => test.expect(reply.closest('[tabindex="0"]')).toHaveFocus());
  }
);

test.stable(
  'starts from a notebook draft, retaining later typing until creation is confirmed',
  async () => {
    const creation = deferred<typeof noteSchema.Type>();

    rpc.create.mockReturnValue(creation.promise);
    rpc.note.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<NoteWorkspace />);
    const input = await openStarterComposer();

    test.fireEvent.change(input, { target: { value: 'Cell cycle lecture' } });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    test.fireEvent.change(input, { target: { value: 'Cell cycle lecture — checkpoint question' } });
    await test.act(async () => creation.resolve({ id } as typeof noteSchema.Type));
    await test.waitFor(() =>
      test
        .expect(view.client.get(startDraft(startDraftKey())))
        .toBe('Cell cycle lecture — checkpoint question')
    );
    test.expect(rpc.create).toHaveBeenCalledExactlyOnceWith({
      project: undefined,
      initialMessage: { text: 'Cell cycle lecture', sourceIds: [] }
    });
  }
);

test.stable('retains the start draft through an uncertain creation and remount', async () => {
  rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
  const first = mount(<NoteWorkspace />);

  test.fireEvent.change(await openStarterComposer(), {
    target: { value: 'Keep these notes' }
  });
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
  await test.screen.findByText('NoteCreationUncertain');
  first.unmount();
  mount(<NoteWorkspace />, first.client);
  test.expect(await openStarterComposer()).toHaveValue('Keep these notes');
  test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
  test.expect(rpc.create).toHaveBeenCalledTimes(1);
});

test.stable(
  'replaces a failed note landing page with the shared error state and recovers on retry',
  async () => {
    rpc.notes.mockRejectedValue(new StudyError('transient', 'Offline'));
    mount(<NoteWorkspace />);
    const alert = await test.screen.findByRole('alert');

    test
      .expect(test.within(alert).getByRole('heading', { name: 'NoteReadErrorTitle' }))
      .toBeVisible();
    test
      .expect(test.screen.queryByRole('textbox', { name: 'NoteCompose' }))
      .not.toBeInTheDocument();
    rpc.notes.mockResolvedValue({ items: [], next: null });
    test.fireEvent.click(test.within(alert).getByRole('button', { name: 'Retry' }));
    test.expect(await openStarterComposer()).toBeVisible();
  }
);

test.stable('fences repeated start shortcuts before the creation receipt arrives', async () => {
  rpc.create.mockReturnValue(new Promise(() => {}));
  mount(<NoteWorkspace />);
  const input = await openStarterComposer();

  test.fireEvent.change(input, { target: { value: 'First capture' } });
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
  );
  test.fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  test.fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  await test.waitFor(() => test.expect(rpc.create).toHaveBeenCalledTimes(1));
  test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
});

test.stable(
  'hands starter files to the confirmed note once and creates in the routed subject',
  async () => {
    const project = Schema.decodeUnknownSync(projectIdSchema)(9007199254740995n);
    const creation = deferred<typeof noteSchema.Type>();

    rpc.create.mockReturnValue(creation.promise);
    rpc.note.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [project],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const upload = test.vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockResolvedValue({ id: 44n } as Awaited<ReturnType<typeof workspaceQueries.uploadSource>>);
    const view = mount(<NoteWorkspace />, cache(), `?project=${project}`);
    const file = new File(['Cell cycle'], 'lecture.txt', { type: 'text/plain' });

    await openStarterComposer();
    test.fireEvent.change(await test.screen.findByLabelText('NoteAttachFiles'), {
      target: { files: [file] }
    });
    test.expect(await test.screen.findByText('lecture.txt')).toBeVisible();
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    await test.waitFor(() =>
      test.expect(rpc.create).toHaveBeenCalledWith({
        project,
        initialMessage: { text: '', sourceIds: [44n] }
      })
    );
    test.expect(upload).toHaveBeenCalledTimes(1);
    test.expect(upload.mock.calls[0]?.[0]).toBe(file);
    await test.act(async () => creation.resolve({ id } as typeof noteSchema.Type));
    test.expect(upload).toHaveBeenCalledTimes(1);
    test.expect(view.client.get(startFiles(startDraftKey(String(project))))).toEqual([]);
  }
);

test.stable('retains selected files across an uncertain create and starter remount', async () => {
  rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
  test.vi
    .spyOn(workspaceQueries, 'uploadSource')
    .mockResolvedValue({ id: 44n } as Awaited<ReturnType<typeof workspaceQueries.uploadSource>>);
  const first = mount(<NoteWorkspace />);
  const file = new File(['Retain me'], 'notes.txt', { type: 'text/plain' });

  await openStarterComposer();
  test.fireEvent.change(await test.screen.findByLabelText('NoteAttachFiles'), {
    target: { files: [file] }
  });
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
  await test.screen.findByText('NoteCreationUncertain');
  first.unmount();
  mount(<NoteWorkspace />, first.client);
  test.expect(await test.screen.findByText('notes.txt')).toBeVisible();
  test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
  test.expect(rpc.create).toHaveBeenCalledTimes(1);
});

test.stable(
  'keeps the active composer mounted while a missing deletion receipt is refreshed',
  async () => {
    rpc.note.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<NoteWorkspace id={id} />);
    const input = await test.screen.findByRole('textbox', { name: 'NoteCompose' });

    test.fireEvent.change(input, { target: { value: 'Keep writing during refresh' } });

    await test.waitFor(() => test.expect(rpc.deletion).toHaveBeenCalled());

    const receipt = deferred<void>();

    rpc.deletion.mockImplementation(async () => {
      await receipt.promise;

      throw new StudyError('not_found', 'Still no deletion');
    });
    let refresh: Promise<void> = Promise.resolve();

    await test.act(async () => {
      refresh = view.notify().then(() => {});
    });
    await test.waitFor(() => test.expect(rpc.deletion.mock.calls.length).toBeGreaterThan(1));
    test.expect(test.screen.getByRole('textbox', { name: 'NoteCompose' })).toBe(input);
    test.expect(input).toHaveValue('Keep writing during refresh');

    await test.act(async () => {
      receipt.resolve(undefined);
      await refresh;
    });
    test.expect(test.screen.getByRole('textbox', { name: 'NoteCompose' })).toBe(input);
    test.expect(input).toHaveValue('Keep writing during refresh');
    const reads = rpc.deletion.mock.calls.length;

    await test.act(async () => {});
    test.expect(rpc.deletion).toHaveBeenCalledTimes(reads);
  }
);

test.stable(
  'blocks editing and file drops after a failed deletion refresh despite a cached missing receipt',
  async () => {
    rpc.note.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const upload = test.vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockReturnValue(new Promise(() => {}));
    const view = mount(<NoteWorkspace id={id} />);
    const input = await test.screen.findByRole('textbox', { name: 'NoteCompose' });

    test.fireEvent.change(input, { target: { value: 'Retained while status is unknown' } });

    await test.waitFor(() => test.expect(rpc.deletion).toHaveBeenCalled());
    rpc.deletion.mockRejectedValue(new StudyError('transient', 'Receipt read unavailable'));
    await test.act(async () => {
      await view.notify().then(() => {});
    });
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('textbox', { name: 'NoteCompose' })).toBeNull()
    );
    test.fireEvent.drop(view.container.querySelector('.note-canvas')!, {
      dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
    });
    test.expect(upload).not.toHaveBeenCalled();
    test.expect(view.client.get(attachmentState(id))).toEqual([]);
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    await test.act(async () => {
      await view.notify().then(() => {});
    });
    test
      .expect(await test.screen.findByRole('textbox', { name: 'NoteCompose' }))
      .toHaveValue('Retained while status is unknown');
  }
);

test.stable(
  'withdraws delete confirmation after a failed deletion refresh while keeping it during a pending refresh',
  async () => {
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<NoteDeleteDialog id={id} open onOpenChange={() => {}} />);
    const confirm = await test.screen.findByRole('button', { name: 'NoteConfirmDelete' });

    test.fireEvent.change(test.screen.getByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    await test.waitFor(() => test.expect(confirm).toBeEnabled());

    await test.waitFor(() => test.expect(rpc.deletion).toHaveBeenCalled());
    const receipt = deferred<void>();

    rpc.deletion.mockImplementation(async () => {
      await receipt.promise;

      throw new StudyError('transient', 'Read failed');
    });
    let refresh = Promise.resolve();

    await test.act(async () => {
      refresh = view.notify().then(() => {});
    });
    test.expect(test.screen.getByRole('button', { name: 'NoteConfirmDelete' })).toBe(confirm);
    await test.act(async () => {
      receipt.resolve(undefined);
      await refresh;
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteConfirmDelete' })).toBeDisabled()
    );
    test.expect(await test.screen.findByRole('alert')).toBeVisible();
    test.expect(rpc.remove).not.toHaveBeenCalled();
  }
);

test.stable('fences notebook drops while a shared deletion mutation is pending', async () => {
  rpc.note.mockResolvedValue({
    id,
    title: 'Notebook',
    projectIds: [],
    createdAt: 1n,
    updatedAt: 1n
  });
  rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
  rpc.remove.mockReturnValue(new Promise(() => {}));
  const upload = test.vi
    .spyOn(workspaceQueries, 'uploadSource')
    .mockReturnValue(new Promise(() => {}));
  const view = mount(
    <>
      <NoteWorkspace id={id} />
      <NoteDeleteDialog id={id} open onOpenChange={() => {}} />
    </>
  );

  await test.waitFor(() =>
    test.expect(view.container.querySelector('.note-canvas textarea')).not.toBeNull()
  );
  const dialog = test.screen.getByRole('alertdialog');

  test.fireEvent.change(test.within(dialog).getByRole('textbox'), {
    target: { value: 'DeleteConfirmationWord' }
  });
  test.fireEvent.click(
    await test.within(dialog).findByRole('button', { name: 'NoteConfirmDelete' })
  );
  await test.waitFor(() => test.expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
  await test.waitFor(() =>
    test.expect(view.container.querySelector('.note-canvas textarea')).toBeNull()
  );
  test.fireEvent.drop(view.container.querySelector('.note-canvas')!, {
    dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
  });
  test.expect(upload).not.toHaveBeenCalled();
  test.expect(view.client.get(attachmentState(id))).toEqual([]);
});

test.stable.each(['', '?project=9007199254740997'])(
  'uses the active note authoritative owner in the direct path breadcrumb %s',
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
    rpc.note.mockResolvedValue({
      id,
      title: 'Cell division',
      projectIds: [owner.id],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<NoteWorkspace id={id} />, cache(), search, `/notes/${id}`);

    await test.screen.findByRole('heading', { name: 'Cell division' });
    const header = view.container.querySelector('.study-workspace-header')!;

    test.expect(test.within(header as HTMLElement).getByText('Biology')).toBeVisible();
    test.expect(test.within(header as HTMLElement).queryByText('History')).toBeNull();
    const context = await test.screen.findByRole('complementary', { name: 'NoteContextPanel' });

    test.expect(test.within(context).queryByRole('combobox')).toBeNull();
    test.expect(test.within(context).queryByRole('link', { name: 'SidebarLibrary' })).toBeNull();
  }
);

test.stable(
  'keeps vertical note actions inside the default card and restores dialog focus and drafts',
  async () => {
    rpc.note.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<NoteWorkspace id={id} />);

    await test.screen.findByRole('button', { name: 'NoteTransform' });
    const panel = await test.screen.findByRole('complementary', { name: 'NoteContextPanel' });

    test.expect(test.screen.getAllByRole('button', { name: 'NoteTransform' })).toHaveLength(1);
    test
      .expect(test.within(panel).getByRole('button', { name: 'NoteArchived' }))
      .toBeInTheDocument();
    test.expect(test.screen.queryByRole('button', { name: 'NoteSelection' })).toBeNull();
    test
      .expect(test.within(panel).getByRole('button', { name: 'NoteTransform' }))
      .toBeInTheDocument();
    test.expect(test.within(panel).getByRole('button', { name: 'NoteDelete' })).toBeInTheDocument();
    test
      .expect(view.container.querySelector('.ui-workspace-dock .note-context-actions'))
      .toBeNull();
    test.expect(test.screen.queryByText('NoteTools')).not.toBeInTheDocument();
    test.fireEvent.click(test.within(panel).getByRole('button', { name: 'NoteTransform' }));
    const dialog = await test.screen.findByRole('dialog', { name: 'NoteTransform' });
    const instruction = test.within(dialog).getByRole('textbox', { name: 'NoteInstructions' });

    test.fireEvent.change(instruction, { target: { value: 'Keep this instruction' } });
    instruction.focus();
    await test.userEvent.setup().keyboard('{Escape}');
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('dialog', { name: 'NoteTransform' })).toBeNull()
    );
    test.expect(test.within(panel).getByRole('button', { name: 'NoteTransform' })).toHaveFocus();
    test.fireEvent.click(test.within(panel).getByRole('button', { name: 'NoteTransform' }));
    await test.screen.findByRole('dialog', { name: 'NoteTransform' });
    test.fireEvent.click(test.within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).toBeNull());
    test.expect(test.screen.queryByRole('dialog')).toBeNull();
    test.expect(test.screen.queryByRole('textbox', { name: 'NoteInstructions' })).toBeNull();
    test.fireEvent.click(test.within(panel).getByRole('button', { name: 'NoteTransform' }));
    test
      .expect(
        test
          .within(await test.screen.findByRole('dialog', { name: 'NoteTransform' }))
          .getByRole('textbox', {
            name: 'NoteInstructions'
          })
      )
      .toBe(instruction);
    test.expect(instruction).toHaveValue('Keep this instruction');
    test.expect(rpc.selection).toHaveBeenCalledWith({ noteId: id });
  }
);

test.stable(
  'retains the notebook edit fence after an uncertain deletion request and remount',
  async () => {
    rpc.note.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    rpc.remove.mockRejectedValue(new StudyError('transient', 'Deletion response lost'));
    const upload = test.vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockReturnValue(new Promise(() => {}));
    const view = mount(
      <>
        <NoteWorkspace id={id} />
        <NoteDeleteDialog id={id} open onOpenChange={() => {}} />
      </>
    );

    await test.waitFor(() =>
      test.expect(view.container.querySelector('.note-canvas textarea')).not.toBeNull()
    );

    await test.waitFor(() => test.expect(rpc.deletion).toHaveBeenCalled());
    rpc.deletion.mockReturnValue(new Promise(() => {}));
    const dialog = test.screen.getByRole('alertdialog');

    test.fireEvent.change(test.within(dialog).getByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'NoteConfirmDelete' }));
    await test.waitFor(() => test.expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
    await test.waitFor(() => test.expect(test.screen.queryByText('NoteDeleting')).toBeNull());
    test.expect(view.container.querySelector('.note-canvas textarea')).toBeNull();
    test.fireEvent.drop(view.container.querySelector('.note-canvas')!, {
      dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
    });
    test.expect(upload).not.toHaveBeenCalled();
    view.unmount();
    const remounted = mount(<NoteWorkspace id={id} />, view.client);

    await test.act(async () => {});
    test.expect(remounted.container.querySelector('.note-canvas textarea')).toBeNull();
    test.expect(view.client.get(attachmentState(id))).toEqual([]);
  }
);

test.stable(
  'does not replay a deletion success notification when reopening a completed note',
  async () => {
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const completion = deferred<typeof noteDeletionSchema.Type>();

    rpc.remove.mockReturnValue(completion.promise);
    const notify = test.vi.spyOn(toastManager, 'add');
    const view = mount(<NoteDeleteDialog id={id} open onOpenChange={() => {}} />);
    const confirm = await test.screen.findByRole('button', { name: 'NoteConfirmDelete' });

    test.fireEvent.change(test.screen.getByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    await test.waitFor(() => test.expect(confirm).toBeEnabled());
    test.fireEvent.click(confirm);
    await test.waitFor(() => test.expect(rpc.remove).toHaveBeenCalledTimes(1));
    view.unmount();
    const receipt = Schema.decodeUnknownSync(noteDeletionSchema)({
      operationId: 'unobserved-completion',
      noteId: id,
      status: 'completed',
      errorKind: null,
      attempt: 1,
      completedAt: 2n
    });

    await test.act(async () => completion.resolve(receipt));
    rpc.deletion.mockResolvedValue(receipt);
    mount(<NoteDeleteDialog id={id} open onOpenChange={() => {}} />, view.client);
    await test.screen.findByText('NoteDeleted');
    test.expect(notify).not.toHaveBeenCalled();
  }
);

test.stable(
  'announces completion once when deleting from the active workspace dialog',
  async () => {
    rpc.note.mockResolvedValue({
      id,
      title: 'Notebook',
      projectIds: [projectIdSchema.make(42n)],
      createdAt: 1n,
      updatedAt: 1n
    });
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const completion = deferred<typeof noteDeletionSchema.Type>();

    rpc.remove.mockReturnValue(completion.promise);
    const notify = test.vi.spyOn(toastManager, 'add');
    const view = mount(<NoteWorkspace id={id} />);

    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteDelete' }));
    const dialog = test.within(await test.screen.findByRole('alertdialog'));

    test.fireEvent.change(dialog.getByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    const confirm = dialog.getByRole('button', { name: 'NoteConfirmDelete' });

    await test.waitFor(() => test.expect(confirm).toBeEnabled());
    test.fireEvent.click(confirm);
    await test.waitFor(() => test.expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
    const receipt = Schema.decodeUnknownSync(noteDeletionSchema)({
      noteId: id,
      operationId: 'owned-workspace-delete',
      status: 'completed',
      errorKind: null,
      attempt: 1,
      completedAt: 2n
    });

    rpc.deletion.mockResolvedValue(receipt);
    await test.act(async () => completion.resolve(receipt));
    await test.screen.findByText('NoteNotesTitle');
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
    test.expect(notify).toHaveBeenCalledExactlyOnceWith({ title: 'NoteDeleted', type: 'success' });
    await test.waitFor(() => test.expect(view.router.state.location.pathname).toBe('/notes'));
    test.expect(view.router.state.location.search).toEqual({ project: '42' });
  }
);

async function openStarterComposer() {
  const entry = await test.waitFor(
    () =>
      test.screen.queryByRole('textbox', { name: 'NoteCompose' }) ??
      test.screen.getByRole('button', { name: 'NoteStartWithNote' })
  );

  if (entry.tagName === 'BUTTON') test.fireEvent.click(entry);

  return test.screen.findByRole('textbox', { name: 'NoteCompose' });
}

test.stable('ignores obsolete selection drafts when starting a note transformation', async () => {
  const client = cache();

  mount(<Transformation id={id} />, client);
  test.fireEvent.change(await test.screen.findByRole('textbox', { name: 'NoteOutputTitle' }), {
    target: { value: 'New summary' }
  });
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
  );
});

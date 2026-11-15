import { StudyError } from '@study/contracts/errors';
import { projectIdSchema, noteIdSchema } from '@study/contracts/ids';
import { noteSelectionSchema } from '@study/contracts/notes/context';
import { noteDeletionSchema } from '@study/contracts/notes/deletion';
import { chatMessageSchema, noteSchema } from '@study/contracts/notes/schemas';
import { transformSnapshotSchema } from '@study/contracts/pages/transform';
import { projectSchema } from '@study/contracts/projects/schemas';
import { endpoints } from '@study/contracts/rpc';
import { blockIdSchema } from '@study/contracts/sources/schemas';
import { executionSchema } from '@study/contracts/workflows/schemas';
import { testStable } from '@study/testing/vitest';
import { toastManager } from '@study/ui/toast';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  stringifySearchWith,
  RouterProvider
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { deferred } from '../material-library/test/support';
import { startDraft, startFiles, startDraftKey } from './start-drafts.queries';
import { creationFlow } from './start.queries';
import { transformDraft } from './transformation.queries';

const pickerPage = (versionId = 102n) => {
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

import { attachmentState } from './attachments';
import { NoteDeleteDialog } from './deletion';
import { History, CapturedContext } from './history';
import * as workspaceQueries from './note-workspace.queries';
import { Transformation } from './transformation';
import { NoteWorkspace } from './workspace';

const rpc = vi.hoisted(() => ({
  note: vi.fn(),
  projects: vi.fn(),
  remove: vi.fn(),
  generations: vi.fn(),
  citations: vi.fn(),
  provenance: vi.fn(),
  deletion: vi.fn(),
  retryDeletion: vi.fn(),
  create: vi.fn(),
  notes: vi.fn(),
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

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
}));

function testFixture(client: AtomRegistry.AtomRegistry) {
  return rpcHandlersTransport(
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

const fixtures = new WeakMap<AtomRegistry.AtomRegistry, ReturnType<typeof rpcHandlersTransport>>();

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

  return { client, router, notify: fixture.notify, ...render(<RouterProvider router={router} />) };
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

beforeEach(() => {
  vi.resetAllMocks();
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
afterEach(() => {
  vi.restoreAllMocks();

  for (const client of caches.splice(0)) client.dispose();
});

testStable.each(['pending', 'failed', 'completed'] as const)(
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
      fireEvent.click(await screen.findByRole('button', { name: 'NoteRetryDelete' }));
      await waitFor(() => expect(rpc.retryDeletion).toHaveBeenCalledWith({ id }));
      await screen.findByText('NoteDeleting');
    } else {
      await screen.findByText(status === 'pending' ? 'NoteDeleting' : 'NoteNotesTitle');

      if (status === 'completed') {
        expect(screen.queryByText('NoteDeleteHelp')).not.toBeInTheDocument();
        expect(await screen.findByRole('textbox', { name: 'NoteCompose' })).toBeEnabled();
        await waitFor(() => expect(view.router.state.location.pathname).toBe('/notes'));
        expect(view.router.state.location.search).toEqual({ project: '42' });
      }
    }

    expect(rpc.deletion).toHaveBeenCalledWith({ id });
    expect(screen.queryByRole('button', { name: 'NoteAsk' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'NoteConfirmDelete' })).not.toBeInTheDocument();
    expect(rpc.selection).not.toHaveBeenCalled();
  }
);

testStable(
  'requires successful list review and deliberate acknowledgment before another ambiguous create',
  async () => {
    rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
    const first = mount(<NoteWorkspace />);

    fireEvent.change(await openStarterComposer(), { target: { value: 'First capture' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await screen.findByText('NoteCreationUncertain');
    first.unmount();
    mount(<NoteWorkspace />, first.client);
    expect(await screen.findByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'NoteCreationReviewed' })).not.toBeInTheDocument();
    await waitFor(() => expect(rpc.notes.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!).toBeEnabled()
    );
    rpc.notes.mockRejectedValueOnce(new StudyError('transient', 'Offline'));
    fireEvent.click(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!);
    await waitFor(() => expect(rpc.notes.mock.calls.length).toBeGreaterThanOrEqual(3));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!).toBeEnabled()
    );
    expect(screen.queryByRole('button', { name: 'NoteCreationReviewed' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'LibraryRefresh' })[0]!);
    fireEvent.click(await screen.findByRole('button', { name: 'NoteCreationReviewed' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    expect(rpc.create).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(2));
  }
);

testStable(
  'allows another create after a definite invalid-input rejection without replaying automatically',
  async () => {
    rpc.create.mockRejectedValue(new StudyError('invalid_input', 'Rejected before commit'));
    mount(<NoteWorkspace />);
    fireEvent.change(await openStarterComposer(), { target: { value: 'First capture' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled();
    expect(screen.queryByText('NoteCreationUncertain')).not.toBeInTheDocument();
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
    await waitFor(() => expect(rpc.executions).toHaveBeenCalled());
    // A newer unrelated failure must not authorize another retry of this attempt.
    await act(async () => {
      rpc.executions.mockImplementation(({ eventId }) => ({
        items: eventId ? [] : [execution('unrelated')],
        next: null
      }));
      await notify(client);
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    await act(async () => {
      const failed = execution('retry-failure');

      rpc.executions.mockResolvedValue({ items: [failed], next: null });
      await notify(client);
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
  await screen.findByText('NoteCancelledTransform');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'NoteCancel' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'NoteNewTransform' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled());
  expect(rpc.retryGeneration).not.toHaveBeenCalled();
});

testStable('exposes operation toggle state and contextual version groups', async () => {
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

  const clarity = await screen.findByRole('button', { name: 'NoteOpClarity' });

  expect(clarity).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(clarity);
  await waitFor(() => expect(clarity).toHaveAttribute('aria-pressed', 'false'));
  const groups = await screen.findAllByRole('group', { name: /^NoteVersions/ });

  expect(groups).toHaveLength(2);
  expect(groups[0]!.getAttribute('aria-label')).not.toBe(groups[1]!.getAttribute('aria-label'));
  const group = within(groups[0]!);

  expect(group.getByRole('status')).toHaveTextContent('NoteVersionLatest');
  fireEvent.click(group.getByRole('button', { name: 'NotePreviousVersion' }));
  expect(group.getByRole('status')).toHaveTextContent('1');
  expect(group.getByRole('button', { name: 'NotePreviousVersion' })).toBeDisabled();
  expect(group.getByRole('button', { name: 'NoteNextVersion' })).toBeEnabled();
});

testStable(
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
    expect(await screen.findByText('Server-selected note')).toBeInTheDocument();
    expect(rpc.notes).toHaveBeenCalledWith({ limit: 30, project, before: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'LibraryMore' }));
    await waitFor(() =>
      expect(rpc.notes).toHaveBeenCalledWith({ limit: 60, project, before: undefined })
    );
  }
);

testStable(
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
    expect(await screen.findByText('Ice is less dense than water.')).toBeVisible();
    expect(screen.queryByText('Question', { selector: 'strong' })).toBeNull();
    expect(screen.getByText('NoteAnswer')).toBeVisible();
    const toolbar = within(screen.getByRole('group', { name: 'NoteItemActions' }));

    expect(toolbar.getByRole('button', { name: 'NoteMarkAsNote' })).toBeVisible();
    expect(toolbar.getByRole('button', { name: 'NoteDeleteItem' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'NoteViewAnswer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NotePreviousVersion' }));
    expect(screen.getByText('Why does ice float?')).toBeVisible();
    expect(screen.queryByText('Ice is less dense than water.')).toBeNull();
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

testStable.each(['pending', 'writing'] as const)(
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

    expect(await screen.findByText(/Original explanation/)).toBeVisible();
    await waitFor(() =>
      expect(rpc.citations).toHaveBeenCalledWith({
        noteId: id,
        messageId: message.id,
        versionId: 62n
      })
    );
    expect(rpc.citations).not.toHaveBeenCalledWith(expect.objectContaining({ versionId: 63n }));
    await waitFor(() =>
      expect(rpc.provenance).toHaveBeenCalledWith(expect.objectContaining({ versionId: 63n }))
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'NoteOpenCitation' }))[0]!);
    expect(await screen.findByText('quote 62')).toBeVisible();
    expect(screen.queryByText('quote 63')).not.toBeInTheDocument();
  }
);

testStable(
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
    await waitFor(() =>
      expect(rpc.citations).toHaveBeenCalledWith({
        noteId: id,
        messageId: message.id,
        versionId: 63n
      })
    );
    expect(screen.queryByText('NoteVersions', { selector: 'summary' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NotePreviousVersion' }));
    await waitFor(() =>
      expect(rpc.citations).toHaveBeenCalledWith({
        noteId: id,
        messageId: message.id,
        versionId: 62n
      })
    );
    expect(screen.queryByText('quote 62')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'NoteOpenCitation' }));
    expect(await screen.findByText('quote 62')).toBeVisible();
    expect(screen.getByRole('link', { name: 'NoteCitationTakeMeThere' })).toHaveAttribute(
      'href',
      '/sources/10?sourceRevision=1&sourceSnapshot=16'
    );
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
      await notify(client);
    });
    await waitFor(() => expect(screen.queryByText('Clarify')).toBeNull());
    expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1')).toBe(true);
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
    const reply = await screen.findByText('Retained reply', { selector: 'p' });

    expect(rpc.provenance).not.toHaveBeenCalled();
    expect(screen.queryByText('NoteContextUsed')).toBeNull();
    fireEvent.contextMenu(reply, { button: 2, clientX: 80, clientY: 80 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'NoteWorkDetails' }));
    expect(await screen.findByRole('dialog', { name: 'NoteWorkDetails' })).toBeVisible();
    expect(await screen.findByText('Clarify')).toBeVisible();
    expect(screen.queryByText('NoteVersions', { selector: 'summary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'NoteVersions' })).toBeNull();
    rpc.provenance.mockRejectedValue(new StudyError('not_found', 'Retired reply context'));

    await act(async () => {
      await notify(client);
    });
    await waitFor(() => expect(screen.queryByText('Clarify')).toBeNull());
    expect(screen.getByText('NoteReadUnavailable')).toBeVisible();
    expect(screen.getByText('Retained reply', { selector: 'p' })).toBeVisible();
    rpc.provenance.mockResolvedValue({ state: 'available', requestId: 'capture-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Clarify')).toBeVisible();
    expect(
      rpc.provenance.mock.calls.every(
        ([input]) => input.noteId === id && input.messageId === 61n && input.versionId === 63n
      )
    ).toBe(true);
    expect(rpc.context.mock.calls.every(([input]) => input.requestId === 'capture-1')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(reply.closest('[tabindex="0"]')).toHaveFocus());
  }
);

testStable(
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

    fireEvent.change(input, { target: { value: 'Cell cycle lecture' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    fireEvent.change(input, { target: { value: 'Cell cycle lecture — checkpoint question' } });
    await act(async () => creation.resolve({ id } as typeof noteSchema.Type));
    await waitFor(() =>
      expect(view.client.get(startDraft(startDraftKey()))).toBe(
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
  const first = mount(<NoteWorkspace />);

  fireEvent.change(await openStarterComposer(), {
    target: { value: 'Keep these notes' }
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
  await screen.findByText('NoteCreationUncertain');
  first.unmount();
  mount(<NoteWorkspace />, first.client);
  expect(await openStarterComposer()).toHaveValue('Keep these notes');
  expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
  expect(rpc.create).toHaveBeenCalledTimes(1);
});

testStable(
  'replaces a failed note landing page with the shared error state and recovers on retry',
  async () => {
    rpc.notes.mockRejectedValue(new StudyError('transient', 'Offline'));
    mount(<NoteWorkspace />);
    const alert = await screen.findByRole('alert');

    expect(within(alert).getByRole('heading', { name: 'NoteReadErrorTitle' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'NoteCompose' })).not.toBeInTheDocument();
    rpc.notes.mockResolvedValue({ items: [], next: null });
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await openStarterComposer()).toBeVisible();
  }
);

testStable('fences repeated start shortcuts before the creation receipt arrives', async () => {
  rpc.create.mockReturnValue(new Promise(() => {}));
  mount(<NoteWorkspace />);
  const input = await openStarterComposer();

  fireEvent.change(input, { target: { value: 'First capture' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
});

testStable(
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
    const upload = vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockResolvedValue({ id: 44n } as Awaited<ReturnType<typeof workspaceQueries.uploadSource>>);
    const view = mount(<NoteWorkspace />, cache(), `?project=${project}`);
    const file = new File(['Cell cycle'], 'lecture.txt', { type: 'text/plain' });

    await openStarterComposer();
    fireEvent.change(await screen.findByLabelText('NoteAttachFiles'), {
      target: { files: [file] }
    });
    expect(await screen.findByText('lecture.txt')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await waitFor(() =>
      expect(rpc.create).toHaveBeenCalledWith({
        project,
        initialMessage: { text: '', sourceIds: [44n] }
      })
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0]).toBe(file);
    await act(async () => creation.resolve({ id } as typeof noteSchema.Type));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(view.client.get(startFiles(startDraftKey(String(project))))).toEqual([]);
  }
);

testStable('retains selected files across an uncertain create and starter remount', async () => {
  rpc.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
  vi.spyOn(workspaceQueries, 'uploadSource').mockResolvedValue({ id: 44n } as Awaited<
    ReturnType<typeof workspaceQueries.uploadSource>
  >);
  const first = mount(<NoteWorkspace />);
  const file = new File(['Retain me'], 'notes.txt', { type: 'text/plain' });

  await openStarterComposer();
  fireEvent.change(await screen.findByLabelText('NoteAttachFiles'), {
    target: { files: [file] }
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
  await screen.findByText('NoteCreationUncertain');
  first.unmount();
  mount(<NoteWorkspace />, first.client);
  expect(await screen.findByText('notes.txt')).toBeVisible();
  expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
  expect(rpc.create).toHaveBeenCalledTimes(1);
});

testStable(
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
    const input = await screen.findByRole('textbox', { name: 'NoteCompose' });

    fireEvent.change(input, { target: { value: 'Keep writing during refresh' } });

    await waitFor(() => expect(rpc.deletion).toHaveBeenCalled());

    const receipt = deferred<void>();

    rpc.deletion.mockImplementation(async () => {
      await receipt.promise;

      throw new StudyError('not_found', 'Still no deletion');
    });
    let refresh: Promise<void> = Promise.resolve();

    await act(async () => {
      refresh = view.notify().then(() => {});
    });
    await waitFor(() => expect(rpc.deletion.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByRole('textbox', { name: 'NoteCompose' })).toBe(input);
    expect(input).toHaveValue('Keep writing during refresh');

    await act(async () => {
      receipt.resolve(undefined);
      await refresh;
    });
    expect(screen.getByRole('textbox', { name: 'NoteCompose' })).toBe(input);
    expect(input).toHaveValue('Keep writing during refresh');
    const reads = rpc.deletion.mock.calls.length;

    await act(async () => {});
    expect(rpc.deletion).toHaveBeenCalledTimes(reads);
  }
);

testStable(
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
    const upload = vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockReturnValue(new Promise(() => {}));
    const view = mount(<NoteWorkspace id={id} />);
    const input = await screen.findByRole('textbox', { name: 'NoteCompose' });

    fireEvent.change(input, { target: { value: 'Retained while status is unknown' } });

    await waitFor(() => expect(rpc.deletion).toHaveBeenCalled());
    rpc.deletion.mockRejectedValue(new StudyError('transient', 'Receipt read unavailable'));
    await act(async () => {
      await view.notify().then(() => {});
    });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'NoteCompose' })).toBeNull());
    fireEvent.drop(view.container.querySelector('.note-canvas')!, {
      dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
    });
    expect(upload).not.toHaveBeenCalled();
    expect(view.client.get(attachmentState(id))).toEqual([]);
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    await act(async () => {
      await view.notify().then(() => {});
    });
    expect(await screen.findByRole('textbox', { name: 'NoteCompose' })).toHaveValue(
      'Retained while status is unknown'
    );
  }
);

testStable(
  'withdraws delete confirmation after a failed deletion refresh while keeping it during a pending refresh',
  async () => {
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const view = mount(<NoteDeleteDialog id={id} open onOpenChange={() => {}} />);
    const confirm = await screen.findByRole('button', { name: 'NoteConfirmDelete' });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DeleteConfirmationWord' } });
    await waitFor(() => expect(confirm).toBeEnabled());

    await waitFor(() => expect(rpc.deletion).toHaveBeenCalled());
    const receipt = deferred<void>();

    rpc.deletion.mockImplementation(async () => {
      await receipt.promise;

      throw new StudyError('transient', 'Read failed');
    });
    let refresh = Promise.resolve();

    await act(async () => {
      refresh = view.notify().then(() => {});
    });
    expect(screen.getByRole('button', { name: 'NoteConfirmDelete' })).toBe(confirm);
    await act(async () => {
      receipt.resolve(undefined);
      await refresh;
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteConfirmDelete' })).toBeDisabled()
    );
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(rpc.remove).not.toHaveBeenCalled();
  }
);

testStable('fences notebook drops while a shared deletion mutation is pending', async () => {
  rpc.note.mockResolvedValue({
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
      <NoteWorkspace id={id} />
      <NoteDeleteDialog id={id} open onOpenChange={() => {}} />
    </>
  );

  await waitFor(() => expect(view.container.querySelector('.note-canvas textarea')).not.toBeNull());
  const dialog = screen.getByRole('alertdialog');

  fireEvent.change(within(dialog).getByRole('textbox'), {
    target: { value: 'DeleteConfirmationWord' }
  });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'NoteConfirmDelete' }));
  await waitFor(() => expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
  await waitFor(() => expect(view.container.querySelector('.note-canvas textarea')).toBeNull());
  fireEvent.drop(view.container.querySelector('.note-canvas')!, {
    dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
  });
  expect(upload).not.toHaveBeenCalled();
  expect(view.client.get(attachmentState(id))).toEqual([]);
});

testStable.each(['', '?project=9007199254740997'])(
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

    await screen.findByRole('heading', { name: 'Cell division' });
    const header = view.container.querySelector('.study-workspace-header')!;

    expect(within(header as HTMLElement).getByText('Biology')).toBeVisible();
    expect(within(header as HTMLElement).queryByText('History')).toBeNull();
    const context = await screen.findByRole('complementary', { name: 'NoteContextPanel' });

    expect(within(context).queryByRole('combobox')).toBeNull();
    expect(within(context).queryByRole('link', { name: 'SidebarLibrary' })).toBeNull();
  }
);

testStable(
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

    await screen.findByRole('button', { name: 'NoteTransform' });
    const panel = await screen.findByRole('complementary', { name: 'NoteContextPanel' });

    expect(screen.getAllByRole('button', { name: 'NoteTransform' })).toHaveLength(1);
    expect(within(panel).getByRole('button', { name: 'NoteArchived' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'NoteSelection' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'NoteTransform' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'NoteDelete' })).toBeInTheDocument();
    expect(view.container.querySelector('.ui-workspace-dock .note-context-actions')).toBeNull();
    expect(screen.queryByText('NoteTools')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'NoteTransform' }));
    const dialog = await screen.findByRole('dialog', { name: 'NoteTransform' });
    const instruction = within(dialog).getByRole('textbox', { name: 'NoteInstructions' });

    fireEvent.change(instruction, { target: { value: 'Keep this instruction' } });
    instruction.focus();
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'NoteTransform' })).toBeNull());
    expect(within(panel).getByRole('button', { name: 'NoteTransform' })).toHaveFocus();
    fireEvent.click(within(panel).getByRole('button', { name: 'NoteTransform' }));
    await screen.findByRole('dialog', { name: 'NoteTransform' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'NoteInstructions' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'NoteTransform' }));
    expect(
      within(await screen.findByRole('dialog', { name: 'NoteTransform' })).getByRole('textbox', {
        name: 'NoteInstructions'
      })
    ).toBe(instruction);
    expect(instruction).toHaveValue('Keep this instruction');
    expect(rpc.selection).toHaveBeenCalledWith({ noteId: id });
  }
);

testStable(
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
    const upload = vi
      .spyOn(workspaceQueries, 'uploadSource')
      .mockReturnValue(new Promise(() => {}));
    const view = mount(
      <>
        <NoteWorkspace id={id} />
        <NoteDeleteDialog id={id} open onOpenChange={() => {}} />
      </>
    );

    await waitFor(() =>
      expect(view.container.querySelector('.note-canvas textarea')).not.toBeNull()
    );

    await waitFor(() => expect(rpc.deletion).toHaveBeenCalled());
    rpc.deletion.mockReturnValue(new Promise(() => {}));
    const dialog = screen.getByRole('alertdialog');

    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'NoteConfirmDelete' }));
    await waitFor(() => expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
    await waitFor(() => expect(screen.queryByText('NoteDeleting')).toBeNull());
    expect(view.container.querySelector('.note-canvas textarea')).toBeNull();
    fireEvent.drop(view.container.querySelector('.note-canvas')!, {
      dataTransfer: { files: [new File(['Blocked'], 'blocked.txt')] }
    });
    expect(upload).not.toHaveBeenCalled();
    view.unmount();
    const remounted = mount(<NoteWorkspace id={id} />, view.client);

    await act(async () => {});
    expect(remounted.container.querySelector('.note-canvas textarea')).toBeNull();
    expect(view.client.get(attachmentState(id))).toEqual([]);
  }
);

testStable(
  'does not replay a deletion success notification when reopening a completed note',
  async () => {
    rpc.deletion.mockRejectedValue(new StudyError('not_found', 'No deletion'));
    const completion = deferred<typeof noteDeletionSchema.Type>();

    rpc.remove.mockReturnValue(completion.promise);
    const notify = vi.spyOn(toastManager, 'add');
    const view = mount(<NoteDeleteDialog id={id} open onOpenChange={() => {}} />);
    const confirm = await screen.findByRole('button', { name: 'NoteConfirmDelete' });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DeleteConfirmationWord' } });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(rpc.remove).toHaveBeenCalledTimes(1));
    view.unmount();
    const receipt = Schema.decodeUnknownSync(noteDeletionSchema)({
      operationId: 'unobserved-completion',
      noteId: id,
      status: 'completed',
      errorKind: null,
      attempt: 1,
      completedAt: 2n
    });

    await act(async () => completion.resolve(receipt));
    rpc.deletion.mockResolvedValue(receipt);
    mount(<NoteDeleteDialog id={id} open onOpenChange={() => {}} />, view.client);
    await screen.findByText('NoteDeleted');
    expect(notify).not.toHaveBeenCalled();
  }
);

testStable('announces completion once when deleting from the active workspace dialog', async () => {
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
  const notify = vi.spyOn(toastManager, 'add');
  const view = mount(<NoteWorkspace id={id} />);

  fireEvent.click(await screen.findByRole('button', { name: 'NoteDelete' }));
  const dialog = within(await screen.findByRole('alertdialog'));

  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'DeleteConfirmationWord' } });
  const confirm = dialog.getByRole('button', { name: 'NoteConfirmDelete' });

  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(rpc.remove).toHaveBeenCalledExactlyOnceWith({ id }));
  const receipt = Schema.decodeUnknownSync(noteDeletionSchema)({
    noteId: id,
    operationId: 'owned-workspace-delete',
    status: 'completed',
    errorKind: null,
    attempt: 1,
    completedAt: 2n
  });

  rpc.deletion.mockResolvedValue(receipt);
  await act(async () => completion.resolve(receipt));
  await screen.findByText('NoteNotesTitle');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: 'NoteDeleted', type: 'success' });
  await waitFor(() => expect(view.router.state.location.pathname).toBe('/notes'));
  expect(view.router.state.location.search).toEqual({ project: '42' });
});

async function openStarterComposer() {
  const entry = await waitFor(
    () =>
      screen.queryByRole('textbox', { name: 'NoteCompose' }) ??
      screen.getByRole('button', { name: 'NoteStartWithNote' })
  );

  if (entry.tagName === 'BUTTON') fireEvent.click(entry);

  return screen.findByRole('textbox', { name: 'NoteCompose' });
}

testStable('ignores obsolete selection drafts when starting a note transformation', async () => {
  const client = cache();

  mount(<Transformation id={id} />, client);
  fireEvent.change(await screen.findByRole('textbox', { name: 'NoteOutputTitle' }), {
    target: { value: 'New summary' }
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled());
});
vi.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));

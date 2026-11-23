import type { createSchema as createManualPageSchema } from '@study/contracts';
import {
  noteIdSchema,
  contentSnapshotIdSchema,
  sourceIdSchema,
  detailSchema as materialDetailSchema
} from '@study/contracts';
import { test } from '@study/testing';
import { WorkspaceCard } from '@study/ui';
import { Schema } from 'effect';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type * as __MockType0 from '../assistant';
import type * as __MockType1 from '../document-editing/test-support';
import type * as __MockType2 from '../source-library/source-panel';
import type * as __MockType3 from './note-layout-controls';
import type * as __MockType4 from './note-page-panel';
import type * as __MockType5 from './workbench';

let AssistantProvider: typeof __MockType0.AssistantProvider;

let material: typeof __MockType1.authoredPage;

let SourcePanel: typeof __MockType2.SourcePanel;

let NoteLayoutControls: typeof __MockType3.NoteLayoutControls;

let NotePagePanel: typeof __MockType4.NotePagePanel;

let NoteWorkbench: typeof __MockType5.NoteWorkbench;

let rpc: ReturnType<typeof createMockState>['rpc'];

function testFixture({ rpcHandlersTransport }: Pick<test.unit.Context, 'rpcHandlersTransport'>) {
  return rpcHandlersTransport({
    'pages.create': rpc.create,
    'pages.copySource': rpc.copy,
    'sources.source': async () => ({
      id: sourceIdSchema.make(41n),
      name: 'Current extraction 41',
      sizeBytes: 1n,
      kind: 'text',
      mime: 'text/plain',
      origin: 'attachment',
      projectId: null,
      projectName: null,
      sha256: new Uint8Array(),
      uri: null,
      createdAt: 1n
    }),
    'sources.currentExtraction': async () => ({
      sourceId: sourceIdSchema.make(41n),
      revision: 3n,
      snapshotId: contentSnapshotIdSchema.make(141n),
      name: 'Current extraction 41',
      document: material(41n, 'Current extraction 41').version!.document
    }),
    'sources.sources': async () => ({ items: [], next: null }),
    'sources.noteSources': async () => [],
    'pages.page': rpc.material,
    'pages.pages': rpc.materials,
    'notes.thread': rpc.thread,
    'notes.body': async () => ({ text: 'Notebook body', versionId: null }),
    'notes.noteAssistant': rpc.assistant,
    'notes.assistantAsk': rpc.ask,
    'notes.assistantContext': async () => ({
      estimatedTokens: 0,
      maxTokens: 50000,
      autoCompact: true,
      lastCompactedAtMs: null
    }),
    'notes.postMessage': rpc.post,
    'notes.noteGenerations': async () => ({ items: [], next: null }),
    'notes.noteSelection': async () => ({ revision: 0n, targets: [] }),
    'notes.note': async () => ({
      id: noteIdSchema.make(12n),
      title: 'Notebook',
      projectIds: [],
      titleSource: 'user',
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    })
  });
}

const noteId = noteIdSchema.make(12n);

let created: ReturnType<typeof material> | undefined;

function mount(
  { render, rpcHandlersTransport }: Pick<test.unit.Context, 'render' | 'rpcHandlersTransport'>,
  children: ReactNode
) {
  const Provider = testFixture({ rpcHandlersTransport }).wrapper;

  return render(
    <Provider>
      <AssistantProvider>
        <WorkspaceCard.Provider>{children}</WorkspaceCard.Provider>
      </AssistantProvider>
    </Provider>
  );
}

function createMockState(mock: test.Mock) {
  return {
    rpc: (() => ({
      create: mock.fn(),
      copy: mock.fn(),
      material: mock.fn(),
      materials: mock.fn(),
      thread: mock.fn(),
      post: mock.fn(),
      assistant: mock.fn(),
      ask: mock.fn()
    }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  rpc = __mockState.rpc;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
  }));
  const __mockModule0 = await import('../assistant');

  AssistantProvider = __mockModule0.AssistantProvider;
  const __mockModule1 = await import('../document-editing/test-support');

  material = __mockModule1.authoredPage;
  const __mockModule2 = await import('../source-library/source-panel');

  SourcePanel = __mockModule2.SourcePanel;
  const __mockModule3 = await import('./note-layout-controls');

  NoteLayoutControls = __mockModule3.NoteLayoutControls;
  const __mockModule4 = await import('./note-page-panel');

  NotePagePanel = __mockModule4.NotePagePanel;
  const __mockModule5 = await import('./workbench');

  NoteWorkbench = __mockModule5.NoteWorkbench;
});

test.unit.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  created = undefined;
  rpc.assistant.mockImplementation(async ({ noteId }: { noteId: bigint }) => ({
    id: noteId + 100n,
    title: 'Assistant',
    projectIds: [],
    titleSource: 'user',
    archivedAt: null,
    createdAt: 1n,
    updatedAt: 1n
  }));
  rpc.thread.mockResolvedValue({ items: [], next: null });
  rpc.materials.mockImplementation(async () => ({
    items: created ? [created] : [],
    nextCursor: null
  }));
  rpc.material.mockImplementation(async ({ id }: { id: bigint }) =>
    created?.id === id ? created : material(id)
  );
  rpc.create.mockImplementation(async (input: typeof createManualPageSchema.Type) => {
    const base = material(52n);
    const version = {
      ...base.version!,
      creator: 'user',
      document: input.document
    };

    created = Schema.decodeUnknownSync(materialDetailSchema)({
      ...base,
      title: input.title,
      version
    });

    return created;
  });
  rpc.copy.mockImplementation(async () => {
    created = material(52n, 'Current extraction 41');

    return created;
  });
});
test.unit.afterEach(({ cleanup }) => {
  cleanup();
});

function ImportedPanel() {
  const [id, setId] = useState<ReturnType<typeof material>['id']>();

  return id ? (
    <NotePagePanel pageId={id} />
  ) : (
    <SourcePanel sourceId={sourceIdSchema.make(41n)} onOpenPage={(next) => setId(next.id)} />
  );
}

test.unit.stable(
  'copying a standalone source pins its exact revision and opens an independent authored page',
  async ({ expect, screen, fireEvent, waitFor, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, <ImportedPanel />);
    expect(await screen.findByText('Current extraction 41', { selector: 'p' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'NotePageEditor' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'PageEditCopy' }));
    await waitFor(() => expect(rpc.copy).toHaveBeenCalledTimes(1));
    expect(rpc.copy.mock.calls[0]![0]).toEqual({
      title: 'Current extraction 41',
      sourceId: sourceIdSchema.make(41n),
      revision: 3n,
      snapshotId: contentSnapshotIdSchema.make(141n),
      createKey: expect.any(String)
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'NotePageEditor' })).toHaveAttribute(
        'contenteditable',
        'true'
      )
    );
    expect(rpc.create).not.toHaveBeenCalled();
    expect(rpc.post).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'keeps vertical note actions in the context card and changes editor docking without creating another document',
  async ({ screen, expect, waitFor, within, fireEvent, render, rpcHandlersTransport }) => {
    const view = mount(
      { render, rpcHandlersTransport },
      <>
        <NoteLayoutControls id={noteId} />
        <NoteWorkbench id={noteId} title="Notebook" onDelete={() => undefined} />
      </>
    );

    expect(screen.queryByRole('complementary', { name: 'NoteContextPanel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteActions' }));
    const card = await screen.findByRole('complementary', { name: 'NoteContextPanel' });
    const notebook = await screen.findByRole('textbox', { name: 'NotePageEditor' });
    const scrollHost = notebook.closest('[data-notebook-scroll-host]');

    expect(notebook).toHaveTextContent('Notebook body');
    expect(scrollHost).toContainElement(card);
    await waitFor(() => expect(card).toBeVisible());
    expect(within(card).queryByRole('button', { name: 'NoteTransform' })).toBeNull();
    expect(screen.getByRole('button', { name: 'NoteDockBelow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NoteDockBeside' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteActions' }));
    await waitFor(() => expect(card).not.toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'NoteActions' }));
    await waitFor(() => expect(card).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'NoteAssistantOpen' }));
    await screen.findByRole('tab', { name: 'NoteAssistant' });
    await waitFor(() => expect(card).not.toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'NoteDockBelow' }));
    await waitFor(() =>
      expect(view.container.querySelector('.workspace-desk')).toHaveAttribute('data-dock', 'bottom')
    );
    expect(screen.getByRole('button', { name: 'NoteDockBelow' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteDockBeside' }));
    await waitFor(() =>
      expect(view.container.querySelector('.workspace-desk')).toHaveAttribute('data-dock', 'side')
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteActions' }));
    await waitFor(() => expect(card).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'NoteDockBeside' }));
    expect(await screen.findByRole('tab', { name: 'NoteAssistant' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'NotePageEditor' })).toBe(notebook);
    expect(rpc.create).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'opens the scoped assistant beside pages and preserves its unsent draft after closing the tab',
  async ({ fireEvent, screen, expect, waitFor, render, rpcHandlersTransport }) => {
    mount(
      { render, rpcHandlersTransport },
      <>
        <NoteLayoutControls id={noteId} />
        <NoteWorkbench id={noteId} title="Notebook" onDelete={() => {}} />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteAssistantOpen' }));
    expect(await screen.findByRole('tab', { name: 'NoteAssistant' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(rpc.assistant).toHaveBeenCalledWith({ noteId });
    const input = await screen.findByRole('textbox', { name: 'StudyChatMessage' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Explain this note' } });
    fireEvent.click(screen.getByRole('button', { name: 'NoteClosePage' }));
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: 'NoteAssistant' })).not.toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteAssistantOpen' }));
    const reopened = await screen.findByRole('textbox', { name: 'StudyChatMessage' });

    await waitFor(() => expect(reopened).toHaveValue('Explain this note'));
    fireEvent.click(screen.getByRole('button', { name: 'NoteAssistantOpen' }));
    expect(screen.getAllByRole('tab', { name: 'NoteAssistant' })).toHaveLength(1);
    expect(rpc.ask).not.toHaveBeenCalled();
  }
);

import {
  noteIdSchema,
  contentSnapshotIdSchema,
  sourceIdSchema,
  createSchema as createManualPageSchema,
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

function testFixture() {
  return test.rpcHandlersTransport({
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

function mount(children: ReactNode) {
  const Provider = testFixture().wrapper;

  return test.render(
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

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  rpc = __mockState.rpc;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
  }));
  mock('#client/features/note-workspace/composer', () => ({ Composer: () => null }));
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

test.beforeEach(() => {
  test.vi.resetAllMocks();
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
test.afterEach(() => {
  test.cleanup();
});

test.stable(
  'New page persists an empty attachment, adds its card, and opens its editable tab',
  async () => {
    mount(<NoteWorkbench id={noteId} onDelete={() => undefined} />);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteNewPage' }));
    await test.waitFor(() => test.expect(rpc.create).toHaveBeenCalledTimes(1));
    const input = rpc.create.mock.calls[0]![0];

    test.expect(Schema.decodeUnknownSync(createManualPageSchema)(input)).toEqual(input);
    test.expect(input).toMatchObject({
      noteId,
      title: 'NoteNewPage',
      createKey: test.expect.any(String)
    });
    test
      .expect(input.document.blocks.every((block: { text: string }) => block.text === ''))
      .toBe(true);
    test.expect(rpc.post).not.toHaveBeenCalled();
    test
      .expect(await test.screen.findByRole('tab', { name: 'NoteNewPage' }))
      .toHaveAttribute('aria-selected', 'true');
    test
      .expect(await test.screen.findByRole('textbox', { name: 'NotePageEditor' }))
      .toHaveAttribute('contenteditable', 'true');
    const history = test.screen.getByRole('region', { name: 'NoteNotebook' });

    test
      .expect(await test.within(history).findByRole('button', { name: /NoteNewPage/ }))
      .toBeVisible();
  }
);

function ImportedPanel() {
  const [id, setId] = useState<ReturnType<typeof material>['id']>();

  return id ? (
    <NotePagePanel pageId={id} />
  ) : (
    <SourcePanel
      noteId={noteId}
      sourceId={sourceIdSchema.make(41n)}
      onOpenPage={(next) => setId(next.id)}
    />
  );
}

test.stable(
  'Edit a copy pins the exact source revision and opens its independent authored page',
  async () => {
    mount(<ImportedPanel />);
    test
      .expect(await test.screen.findByText('Current extraction 41', { selector: 'p' }))
      .toBeVisible();
    test.expect(test.screen.queryByRole('textbox', { name: 'NotePageEditor' })).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'PageEditCopy' }));
    await test.waitFor(() => test.expect(rpc.copy).toHaveBeenCalledTimes(1));
    test.expect(rpc.copy.mock.calls[0]![0]).toEqual({
      noteId,
      title: 'Current extraction 41',
      sourceId: sourceIdSchema.make(41n),
      revision: 3n,
      snapshotId: contentSnapshotIdSchema.make(141n),
      createKey: test.expect.any(String)
    });
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('textbox', { name: 'NotePageEditor' }))
        .toHaveAttribute('contenteditable', 'true')
    );
    test.expect(rpc.create).not.toHaveBeenCalled();
    test.expect(rpc.post).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps vertical note actions in the default card and changes editor docking without creating another document',
  async () => {
    const view = mount(
      <>
        <NoteLayoutControls id={noteId} />
        <NoteWorkbench id={noteId} onDelete={() => undefined} />
      </>
    );
    const card = test.screen.getByRole('complementary', { name: 'NoteContextPanel' });
    const scrollHost = test.screen
      .getByRole('log', { name: 'NoteNotebook' })
      .closest('[data-notebook-scroll-host]');

    test.expect(scrollHost).toContainElement(card);
    test
      .expect(
        view.container.querySelector('.ui-workspace-dock')?.closest('[data-notebook-scroll-host]')
      )
      .toBeNull();

    await test.waitFor(() => test.expect(card).toBeVisible());
    test.expect(test.within(card).getByRole('button', { name: 'NoteTransform' })).toBeVisible();
    test.expect(test.screen.getByRole('button', { name: 'NoteDockBelow' })).toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'NoteDockBeside' })).toBeDisabled();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteActions' }));
    await test.waitFor(() => test.expect(card).not.toBeVisible());
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteActions' }));
    await test.waitFor(() => test.expect(card).toBeVisible());
    test.fireEvent.click(test.within(card).getByRole('button', { name: 'NoteNewPage' }));
    await test.screen.findByRole('tab', { name: 'NoteNewPage' });
    await test.waitFor(() => test.expect(card).not.toBeVisible());
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteDockBelow' }));
    await test.waitFor(() =>
      test
        .expect(view.container.querySelector('.workspace-desk'))
        .toHaveAttribute('data-dock', 'bottom')
    );
    test
      .expect(test.screen.getByRole('button', { name: 'NoteDockBelow' }))
      .toHaveAttribute('aria-pressed', 'true');
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteDockBeside' }));
    await test.waitFor(() =>
      test
        .expect(view.container.querySelector('.workspace-desk'))
        .toHaveAttribute('data-dock', 'side')
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteActions' }));
    await test.waitFor(() => test.expect(card).toBeVisible());
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteDockBeside' }));
    test.expect(await test.screen.findByRole('tab', { name: 'NoteNewPage' })).toBeVisible();
    test.expect(rpc.create).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'opens the scoped assistant beside pages and preserves its unsent draft after closing the tab',
  async () => {
    mount(
      <>
        <NoteLayoutControls id={noteId} />
        <NoteWorkbench id={noteId} onDelete={() => {}} />
      </>
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteAssistantOpen' }));
    test
      .expect(await test.screen.findByRole('tab', { name: 'NoteAssistant' }))
      .toHaveAttribute('aria-selected', 'true');
    test.expect(rpc.assistant).toHaveBeenCalledWith({ noteId });
    const input = await test.screen.findByRole('textbox', { name: 'StudyChatMessage' });

    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.fireEvent.change(input, { target: { value: 'Explain this note' } });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteClosePage' }));
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('tab', { name: 'NoteAssistant' })).not.toBeInTheDocument()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteAssistantOpen' }));
    test
      .expect(await test.screen.findByRole('textbox', { name: 'StudyChatMessage' }))
      .toHaveValue('Explain this note');
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteAssistantOpen' }));
    test.expect(test.screen.getAllByRole('tab', { name: 'NoteAssistant' })).toHaveLength(1);
    test.expect(rpc.ask).not.toHaveBeenCalled();
  }
);

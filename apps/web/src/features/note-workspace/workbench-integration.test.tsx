import { noteIdSchema } from '@study/contracts/ids';
import { sourceIdSchema } from '@study/contracts/ids';
import { createSchema as createManualPageSchema } from '@study/contracts/pages/editing';
import { detailSchema as materialDetailSchema } from '@study/contracts/pages/schemas';
import { testStable } from '@study/testing/vitest';
import { WorkspaceCard } from '@study/ui/workspace';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { AssistantProvider } from '../assistant';
import { authoredPage as material } from '../document-editing/test-support';
import { SourcePanel } from '../source-library/source-panel';
import { NoteLayoutControls } from './note-layout-controls';
import { NotePagePanel } from './note-page-panel';
import { NoteWorkbench } from './workbench';

const rpc = vi.hoisted(() => ({
  create: vi.fn(),
  copy: vi.fn(),
  material: vi.fn(),
  materials: vi.fn(),
  thread: vi.fn(),
  post: vi.fn(),
  assistant: vi.fn(),
  ask: vi.fn()
}));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => Effect.Effect<unknown, unknown>) => {
    const methods = {
      'pages.create': rpc.create,
      'pages.copySource': rpc.copy,
      'sources.source': async () => ({ id: 41n, name: 'Current extraction 41', sizeBytes: 1n }),
      'sources.currentExtraction': async () => ({
        sourceId: 41n,
        revision: 3n,
        snapshotId: 141n,
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
      'notes.note': async () => ({ id: 12n, title: 'Notebook', projectIds: [] })
    };
    const client = Object.fromEntries(
      Object.entries(methods).map(([name, method]) => [
        name,
        (...args: never[]) => Effect.promise(() => Promise.resolve(method(...args)))
      ])
    );

    return Effect.runPromise(invoke(client));
  }
}));
vi.mock('./composer', () => ({ Composer: () => null }));

const noteId = noteIdSchema.make(12n);

const clients: QueryClient[] = [];

let created: ReturnType<typeof material> | undefined;

function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(client);

  return render(
    <QueryClientProvider client={client}>
      <AssistantProvider>
        <WorkspaceCard.Provider>{children}</WorkspaceCard.Provider>
      </AssistantProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
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
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

testStable(
  'New document persists an empty attachment, adds its card, and opens its editable tab',
  async () => {
    mount(<NoteWorkbench id={noteId} onDelete={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'NoteNewPage' }));
    await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
    const input = rpc.create.mock.calls[0]![0];

    expect(Schema.decodeUnknownSync(createManualPageSchema)(input)).toEqual(input);
    expect(input).toMatchObject({
      noteId,
      title: 'NoteNewPage',
      createKey: expect.any(String)
    });
    expect(input.document.blocks.every((block: { text: string }) => block.text === '')).toBe(true);
    expect(rpc.post).not.toHaveBeenCalled();
    expect(await screen.findByRole('tab', { name: 'NoteNewPage' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(await screen.findByRole('textbox', { name: 'NotePageEditor' })).toHaveAttribute(
      'contenteditable',
      'true'
    );
    const history = screen.getByRole('region', { name: 'NoteNotebook' });

    expect(await within(history).findByRole('button', { name: /NoteNewPage/ })).toBeVisible();
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

testStable(
  'Edit a copy pins the exact source revision and opens its independent authored document',
  async () => {
    mount(<ImportedPanel />);
    expect(await screen.findByText('Current extraction 41', { selector: 'p' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'NotePageEditor' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'PageEditCopy' }));
    await waitFor(() => expect(rpc.copy).toHaveBeenCalledTimes(1));
    expect(rpc.copy.mock.calls[0]![0]).toEqual({
      noteId,
      title: 'Current extraction 41',
      sourceId: 41n,
      revision: 3n,
      snapshotId: 141n,
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

testStable(
  'keeps vertical note actions in the default card and changes editor docking without creating another document',
  async () => {
    const view = mount(
      <>
        <NoteLayoutControls id={noteId} />
        <NoteWorkbench id={noteId} onDelete={() => undefined} />
      </>
    );
    const card = screen.getByRole('complementary', { name: 'NoteContextPanel' });
    const scrollHost = screen
      .getByRole('log', { name: 'NoteNotebook' })
      .closest('[data-notebook-scroll-host]');

    expect(scrollHost).toContainElement(card);
    expect(
      view.container.querySelector('.ui-workspace-dock')?.closest('[data-notebook-scroll-host]')
    ).toBeNull();

    await waitFor(() => expect(card).toBeVisible());
    expect(within(card).getByRole('button', { name: 'NoteTransform' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'NoteDockBelow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NoteDockBeside' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteActions' }));
    await waitFor(() => expect(card).not.toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'NoteActions' }));
    await waitFor(() => expect(card).toBeVisible());
    fireEvent.click(within(card).getByRole('button', { name: 'NoteNewPage' }));
    await screen.findByRole('tab', { name: 'NoteNewPage' });
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
    expect(await screen.findByRole('tab', { name: 'NoteNewPage' })).toBeVisible();
    expect(rpc.create).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'opens the scoped assistant beside pages and preserves its unsent draft after closing the tab',
  async () => {
    mount(
      <>
        <NoteLayoutControls id={noteId} />
        <NoteWorkbench id={noteId} onDelete={() => {}} />
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
    expect(await screen.findByRole('textbox', { name: 'StudyChatMessage' })).toHaveValue(
      'Explain this note'
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteAssistantOpen' }));
    expect(screen.getAllByRole('tab', { name: 'NoteAssistant' })).toHaveLength(1);
    expect(rpc.ask).not.toHaveBeenCalled();
  }
);

import { createSchema as createManualDocumentSchema } from '@study/contracts/documents/editing';
import { detailSchema as materialDetailSchema } from '@study/contracts/documents/schemas';
import { sessionIdSchema } from '@study/contracts/ids';
import { sourceIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { WorkspaceCard } from '@study/ui/workspace';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { authoredDocument as material } from '../document-editing/test-support';
import { SourcePanel } from '../source-library/source-panel';
import { SessionDocumentPanel } from './session-document-panel';
import { SessionLayoutControls } from './session-layout-controls';
import { SessionWorkbench } from './workbench';

const rpc = vi.hoisted(() => ({
  create: vi.fn(),
  copy: vi.fn(),
  material: vi.fn(),
  materials: vi.fn(),
  thread: vi.fn(),
  post: vi.fn()
}));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => Effect.Effect<unknown, unknown>) => {
    const methods = {
      'documents.create': rpc.create,
      'documents.copySource': rpc.copy,
      'sources.source': async () => ({ id: 41n, name: 'Current extraction 41', sizeBytes: 1n }),
      'sources.currentExtraction': async () => ({
        sourceId: 41n,
        revision: 3n,
        snapshotId: 141n,
        name: 'Current extraction 41',
        document: material(41n, 'Current extraction 41').version!.document
      }),
      'sources.sources': async () => ({ items: [], next: null }),
      'sources.sessionSources': async () => [],
      'documents.document': rpc.material,
      'documents.documents': rpc.materials,
      'conversations.thread': rpc.thread,
      'conversations.postMessage': rpc.post,
      'conversations.sessionGenerations': async () => ({ items: [], next: null }),
      'conversations.sessionSelection': async () => ({ revision: 0n, targets: [] }),
      'conversations.session': async () => ({ id: 12n, title: 'Notebook', projectIds: [] })
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

const sessionId = sessionIdSchema.make(12n);

const clients: QueryClient[] = [];

let created: ReturnType<typeof material> | undefined;

function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(client);

  return render(
    <QueryClientProvider client={client}>
      <WorkspaceCard.Provider>{children}</WorkspaceCard.Provider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  created = undefined;
  rpc.thread.mockResolvedValue({ items: [], next: null });
  rpc.materials.mockImplementation(async () => ({
    items: created ? [created] : [],
    nextCursor: null
  }));
  rpc.material.mockImplementation(async ({ id }: { id: bigint }) =>
    created?.id === id ? created : material(id)
  );
  rpc.create.mockImplementation(async (input: typeof createManualDocumentSchema.Type) => {
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
    mount(<SessionWorkbench id={sessionId} onDelete={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'SessionNewDocument' }));
    await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
    const input = rpc.create.mock.calls[0]![0];

    expect(Schema.decodeUnknownSync(createManualDocumentSchema)(input)).toEqual(input);
    expect(input).toMatchObject({
      sessionId,
      title: 'SessionNewPage',
      createKey: expect.any(String)
    });
    expect(input.document.blocks.every((block: { text: string }) => block.text === '')).toBe(true);
    expect(rpc.post).not.toHaveBeenCalled();
    expect(await screen.findByRole('tab', { name: 'SessionNewPage' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(await screen.findByRole('textbox', { name: 'SessionPageEditor' })).toHaveAttribute(
      'contenteditable',
      'true'
    );
    const history = screen.getByRole('region', { name: 'SessionNotebook' });

    expect(await within(history).findByRole('button', { name: /SessionNewPage/ })).toBeVisible();
  }
);

function ImportedPanel() {
  const [id, setId] = useState<ReturnType<typeof material>['id']>();

  return id ? (
    <SessionDocumentPanel documentId={id} />
  ) : (
    <SourcePanel
      sessionId={sessionId}
      sourceId={sourceIdSchema.make(41n)}
      onOpenDocument={(next) => setId(next.id)}
    />
  );
}

testStable(
  'Edit a copy pins the exact source revision and opens its independent authored document',
  async () => {
    mount(<ImportedPanel />);
    expect(await screen.findByText('Current extraction 41', { selector: 'p' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'SessionPageEditor' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'DocumentEditCopy' }));
    await waitFor(() => expect(rpc.copy).toHaveBeenCalledTimes(1));
    expect(rpc.copy.mock.calls[0]![0]).toEqual({
      sessionId,
      title: 'Current extraction 41',
      sourceId: 41n,
      revision: 3n,
      snapshotId: 141n,
      createKey: expect.any(String)
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'SessionPageEditor' })).toHaveAttribute(
        'contenteditable',
        'true'
      )
    );
    expect(rpc.create).not.toHaveBeenCalled();
    expect(rpc.post).not.toHaveBeenCalled();
  }
);

testStable(
  'keeps vertical session actions in the default card and changes editor docking without creating another document',
  async () => {
    const view = mount(
      <>
        <SessionLayoutControls id={sessionId} />
        <SessionWorkbench id={sessionId} onDelete={() => undefined} />
      </>
    );
    const card = screen.getByRole('complementary', { name: 'SessionContextPanel' });
    const scrollHost = screen
      .getByRole('log', { name: 'SessionNotebook' })
      .closest('[data-notebook-scroll-host]');

    expect(scrollHost).toContainElement(card);
    expect(
      view.container.querySelector('.ui-workspace-dock')?.closest('[data-notebook-scroll-host]')
    ).toBeNull();

    await waitFor(() => expect(card).toBeVisible());
    expect(within(card).getByRole('button', { name: 'SessionTransform' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'SessionDockBelow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SessionDockBeside' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'SessionActions' }));
    await waitFor(() => expect(card).not.toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'SessionActions' }));
    await waitFor(() => expect(card).toBeVisible());
    fireEvent.click(within(card).getByRole('button', { name: 'SessionNewDocument' }));
    await screen.findByRole('tab', { name: 'SessionNewPage' });
    await waitFor(() => expect(card).not.toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'SessionDockBelow' }));
    await waitFor(() =>
      expect(view.container.querySelector('.session-desk')).toHaveAttribute('data-dock', 'bottom')
    );
    expect(screen.getByRole('button', { name: 'SessionDockBelow' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionDockBeside' }));
    await waitFor(() =>
      expect(view.container.querySelector('.session-desk')).toHaveAttribute('data-dock', 'side')
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionActions' }));
    await waitFor(() => expect(card).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'SessionDockBeside' }));
    expect(await screen.findByRole('tab', { name: 'SessionNewPage' })).toBeVisible();
    expect(rpc.create).toHaveBeenCalledTimes(1);
  }
);

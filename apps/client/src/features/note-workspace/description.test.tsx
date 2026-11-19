import {
  StudyError,
  chatMessageSchema,
  summarySchema as materialSummarySchema,
  sourceKinds
} from '@study/contracts';
import { mediaSize } from '@study/localization';
import { test } from '@study/testing';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { Schema } from 'effect';
import type { ReactNode } from 'react';

import type * as __MockType0 from './description';
import type * as __MockType1 from './history';

let Description: typeof __MockType0.Description;

let History: typeof __MockType1.History;

let rpc: ReturnType<typeof createMockState>['rpc'];

const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 71n,
  noteId: 501n,
  format: 'document',
  description: 'Review before the exam',
  role: 'user',
  threadRoot: null,
  replyTo: null,
  activeVersionId: 81n,
  recordingId: null,
  recordingMs: null,
  recordedIn: null,
  createdAt: 1n,
  versions: [
    {
      id: 81n,
      number: 1n,
      origin: 'typed',
      status: 'complete',
      text: '# Linear algebra\n\nThis body preview is secondary.',
      basedOn: null,
      instruction: null,
      createdAt: 1n
    }
  ],
  parts: [],
  citations: []
});

function mount(
  { rpcHandlersTransport, render }: Pick<test.unit.Context, 'rpcHandlersTransport' | 'render'>,
  children: ReactNode
) {
  const fixture = rpcHandlersTransport({
    'notes.updateMessageDescription': rpc.update,
    'notes.thread': rpc.thread,
    'notes.messageVersionCitations': rpc.citations,
    'notes.noteSelection': rpc.selection,
    'sources.source': rpc.source
  });

  return render(children, { wrapper: fixture.wrapper });
}

async function openDescription({
  fireEvent,
  screen,
  within,
  rpcHandlersTransport,
  render
}: Pick<test.unit.Context, 'fireEvent' | 'screen' | 'within' | 'rpcHandlersTransport' | 'render'>) {
  mount({ rpcHandlersTransport, render }, <Description message={message} />);
  fireEvent.click(screen.getByRole('button', { name: 'NoteDescriptionTitle' }));
  const dialog = await screen.findByRole('dialog', { name: 'NoteDescriptionTitle' });

  return {
    dialog,
    input: within(dialog).getByRole('textbox', { name: 'NoteDescriptionLabel' })
  };
}

function createMockState(mock: test.Mock) {
  return {
    rpc: (() => ({
      update: mock.fn(),
      thread: mock.fn(),
      citations: mock.fn(),
      selection: mock.fn(),
      material: mock.fn(),
      source: mock.fn()
    }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  rpc = __mockState.rpc;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
  }));
  const __mockModule0 = await import('./description');

  Description = __mockModule0.Description;
  const __mockModule1 = await import('./history');

  History = __mockModule1.History;
});

test.unit.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  rpc.update.mockResolvedValue(message);
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  rpc.citations.mockResolvedValue({ citations: [] });
  rpc.selection.mockResolvedValue({ revision: 1n, targets: [] });
});

test.unit.afterEach(({ cleanup }) => {
  cleanup();
});

test.unit.stable(
  'saves trimmed descriptions against their original value and closes after success',
  async ({ expect, fireEvent, within, waitFor, screen, rpcHandlersTransport, render }) => {
    const { dialog, input } = await openDescription({
      fireEvent,
      screen,
      within,
      rpcHandlersTransport,
      render
    });

    expect(input).toHaveValue(message.description);
    fireEvent.change(input, { target: { value: '  Focus on eigenvectors  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc.update).toHaveBeenCalledExactlyOnceWith({
        messageId: message.id,
        description: 'Focus on eigenvectors',
        expectedDescription: message.description
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }
);

test.unit.stable(
  'keeps the entered description and shows an error when a save fails',
  async ({ fireEvent, within, expect, screen, rpcHandlersTransport, render }) => {
    rpc.update.mockRejectedValue(new StudyError('transient', 'Save unavailable'));
    const { dialog, input } = await openDescription({
      fireEvent,
      screen,
      within,
      rpcHandlersTransport,
      render
    });

    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(input).toHaveValue('Keep this draft');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(rpc.update).toHaveBeenCalledTimes(1);
  }
);

test.unit.stable(
  'clears a saved description when the field contains only whitespace',
  async ({ fireEvent, within, waitFor, expect, screen, rpcHandlersTransport, render }) => {
    const { dialog, input } = await openDescription({
      fireEvent,
      screen,
      within,
      rpcHandlersTransport,
      render
    });

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc.update).toHaveBeenCalledExactlyOnceWith({
        messageId: message.id,
        description: null,
        expectedDescription: message.description
      })
    );
  }
);

test.unit.stable(
  'shows the stored description on the document card and opens the original message',
  async ({ vi, screen, expect, fireEvent, within, rpcHandlersTransport, render }) => {
    const onOpen = vi.fn();

    const view = mount(
      { rpcHandlersTransport, render },
      <History id={message.noteId} onOpen={onOpen} />
    );
    const description = await screen.findByText('Review before the exam');

    expect(description).toBeVisible();
    expect(screen.queryByText('This body preview is secondary.')).toBeNull();
    fireEvent.click(
      within(view.container.querySelector('.note-index-target')!).getByRole('button', {
        name: /Linear algebra/
      })
    );
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(message);
  }
);

test.unit.stable.for(['text', undefined] as const)(
  'renders Markdown inline for %s quick captures',
  async (format, { vi, expect, within, screen, rpcHandlersTransport, render }) => {
    const markdown = '# A quick thought **with emphasis** and [a link](https://example.com)';
    const quick = Schema.decodeUnknownSync(chatMessageSchema)({
      ...message,
      format,
      description: null,
      versions: [{ ...message.versions[0], text: markdown }]
    });
    const onOpen = vi.fn();

    rpc.thread.mockResolvedValue({ items: [quick], next: null });
    const view = mount(
      { rpcHandlersTransport, render },
      <History id={message.noteId} onOpen={onOpen} />
    );

    const heading = await within(view.container.querySelector('.note-history')!).findByRole(
      'heading',
      { level: 1, name: 'A quick thought with emphasis and a link' }
    );

    expect(heading.querySelector('strong')).toHaveTextContent('with emphasis');
    expect(within(heading).getByRole('link', { name: 'a link' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
    expect(view.container.querySelector('.workspace-desk-page')).toBeNull();
    expect(screen.queryByRole('button', { name: 'NoteOpenPage' })).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'shows a linked attachment card with kind and size for every canonical source kind',
  async ({ vi, screen, expect, within, rpcHandlersTransport, render }) => {
    const attached = Schema.decodeUnknownSync(chatMessageSchema)({
      ...message,
      format: 'text',
      parts: sourceKinds.map((kind, index) => ({
        id: BigInt(index + 1),
        sourceId: BigInt(index + 100),
        sourceName: `Attached ${kind}`,
        sourceKind: kind
      }))
    });

    rpc.thread.mockResolvedValue({ items: [attached], next: null });
    rpc.material.mockImplementation(({ sourceId }: { sourceId: bigint }) =>
      Promise.resolve({ id: sourceId + 1000n })
    );
    rpc.source.mockImplementation(async ({ id }: { id: bigint }) => ({
      id,
      name: `Source ${id}`,
      kind: sourceKinds[Number(id - 100n)],
      mime: 'application/octet-stream',
      origin: 'attachment',
      projectId: null,
      projectName: null,
      sha256: new Uint8Array(),
      uri: null,
      createdAt: 1n,
      sizeBytes: 2048n
    }));
    const root = createRootRoute({
      component: () => <History id={message.noteId} onOpen={vi.fn()} />
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] })
    });

    mount({ rpcHandlersTransport, render }, <RouterProvider router={router} />);

    for (const [index, kind] of sourceKinds.entries()) {
      const link = await screen.findByRole('link', { name: new RegExp(`Attached ${kind}`) });

      expect(link).toHaveAttribute('href', `/sources/${index + 100}`);
      expect(
        await within(link).findByText(
          `Source${kind[0]!.toUpperCase()}${kind.slice(1)} · ${mediaSize('english', 2048)}`
        )
      ).toBeVisible();
      expect(link.querySelector('svg')).not.toBeNull();
    }

    expect(screen.getAllByRole('link')).toHaveLength(sourceKinds.length);
  }
);

test.unit.stable(
  'places real document attachments in time order alongside plain notes and opens their material',
  async ({ vi, within, expect, fireEvent, rpcHandlersTransport, render }) => {
    const material = Schema.decodeUnknownSync(materialSummarySchema)({
      id: 90n,
      projectIds: [],
      title: 'Working page',
      description: 'A real editable attachment',
      createdAt: 2n,
      updatedAt: 2n,
      archivedAt: null,
      headVersionId: 100n
    });
    const earlier = {
      ...message,
      format: 'text' as const,
      versions: [{ ...message.versions[0]!, text: 'Before the document' }]
    };
    const later = {
      ...earlier,
      id: Schema.decodeUnknownSync(chatMessageSchema)({ ...message, id: 72n }).id,
      createdAt: 3n,
      versions: [{ ...message.versions[0]!, text: 'After the document' }]
    };

    rpc.thread.mockResolvedValue({ items: [later, earlier], next: null });
    const open = vi.fn();
    const view = mount(
      { rpcHandlersTransport, render },
      <History id={message.noteId} pages={[material]} onOpenPage={open} />
    );

    await within(view.container.querySelector('.note-history')!).findByText('Before the document');
    const items = view.container.querySelectorAll('.note-entry, .workspace-desk-page');

    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Before the document');
    expect(items[1]).toHaveTextContent('Working page');
    expect(items[2]).toHaveTextContent('After the document');
    fireEvent.click(
      within(items[1]!.closest('.note-index-target')!).getByRole('button', {
        name: /Working page/
      })
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(material);
  }
);

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

function mount(children: ReactNode) {
  const fixture = test.rpcHandlersTransport({
    'notes.updateMessageDescription': rpc.update,
    'notes.thread': rpc.thread,
    'notes.messageVersionCitations': rpc.citations,
    'notes.noteSelection': rpc.selection,
    'sources.source': rpc.source
  });

  return test.render(children, { wrapper: fixture.wrapper });
}

async function openDescription() {
  mount(<Description message={message} />);
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteDescriptionTitle' }));
  const dialog = await test.screen.findByRole('dialog', { name: 'NoteDescriptionTitle' });

  return {
    dialog,
    input: test.within(dialog).getByRole('textbox', { name: 'NoteDescriptionLabel' })
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

test.beforeEach(async ({ mock }) => {
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

test.beforeEach(() => {
  test.vi.resetAllMocks();
  rpc.update.mockResolvedValue(message);
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  rpc.citations.mockResolvedValue({ citations: [] });
  rpc.selection.mockResolvedValue({ revision: 1n, targets: [] });
});

test.afterEach(() => {
  test.cleanup();
});

test.stable(
  'saves trimmed descriptions against their original value and closes after success',
  async () => {
    const { dialog, input } = await openDescription();

    test.expect(input).toHaveValue(message.description);
    test.fireEvent.change(input, { target: { value: '  Focus on eigenvectors  ' } });
    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'Save' }));
    await test.waitFor(() =>
      test.expect(rpc.update).toHaveBeenCalledExactlyOnceWith({
        messageId: message.id,
        description: 'Focus on eigenvectors',
        expectedDescription: message.description
      })
    );
    await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).toBeNull());
  }
);

test.stable('keeps the entered description and shows an error when a save fails', async () => {
  rpc.update.mockRejectedValue(new StudyError('transient', 'Save unavailable'));
  const { dialog, input } = await openDescription();

  test.fireEvent.change(input, { target: { value: 'Keep this draft' } });
  test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'Save' }));
  test.expect(await test.within(dialog).findByRole('alert')).toBeVisible();
  test.expect(input).toHaveValue('Keep this draft');
  test.expect(test.within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
  test.expect(rpc.update).toHaveBeenCalledTimes(1);
});

test.stable('clears a saved description when the field contains only whitespace', async () => {
  const { dialog, input } = await openDescription();

  test.fireEvent.change(input, { target: { value: '   ' } });
  test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'Save' }));
  await test.waitFor(() =>
    test.expect(rpc.update).toHaveBeenCalledExactlyOnceWith({
      messageId: message.id,
      description: null,
      expectedDescription: message.description
    })
  );
});

test.stable(
  'shows the stored description on the document card and opens the original message',
  async () => {
    const onOpen = test.vi.fn();

    const view = mount(<History id={message.noteId} onOpen={onOpen} />);
    const description = await test.screen.findByText('Review before the exam');

    test.expect(description).toBeVisible();
    test.expect(test.screen.queryByText('This body preview is secondary.')).toBeNull();
    test.fireEvent.click(
      test.within(view.container.querySelector('.note-index-target')!).getByRole('button', {
        name: /Linear algebra/
      })
    );
    test.expect(onOpen).toHaveBeenCalledExactlyOnceWith(message);
  }
);

test.stable.each(['text', undefined] as const)(
  'keeps %s quick captures as literal text rather than document cards',
  async (format) => {
    const literal = '# A quick thought **with stars** and [a link](https://example.com)';
    const quick = Schema.decodeUnknownSync(chatMessageSchema)({
      ...message,
      format,
      description: null,
      versions: [{ ...message.versions[0], text: literal }]
    });
    const onOpen = test.vi.fn();

    rpc.thread.mockResolvedValue({ items: [quick], next: null });
    const view = mount(<History id={message.noteId} onOpen={onOpen} />);

    test
      .expect(await test.within(view.container.querySelector('.note-history')!).findByText(literal))
      .toBeVisible();
    test.expect(test.screen.queryByRole('heading', { name: 'A quick thought' })).toBeNull();
    test.expect(test.screen.queryByRole('link', { name: 'a link' })).toBeNull();
    test.expect(view.container.querySelector('.workspace-desk-page')).toBeNull();
    test.expect(test.screen.queryByRole('button', { name: 'NoteOpenPage' })).toBeNull();
    test.expect(onOpen).not.toHaveBeenCalled();
  }
);

test.stable(
  'shows a linked attachment card with kind and size for every canonical source kind',
  async () => {
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
      component: () => <History id={message.noteId} onOpen={test.vi.fn()} />
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] })
    });

    mount(<RouterProvider router={router} />);

    for (const [index, kind] of sourceKinds.entries()) {
      const link = await test.screen.findByRole('link', { name: new RegExp(`Attached ${kind}`) });

      test.expect(link).toHaveAttribute('href', `/sources/${index + 100}`);
      test
        .expect(
          await test
            .within(link)
            .findByText(
              `Source${kind[0]!.toUpperCase()}${kind.slice(1)} · ${mediaSize('english', 2048)}`
            )
        )
        .toBeVisible();
      test.expect(link.querySelector('svg')).not.toBeNull();
    }

    test.expect(test.screen.getAllByRole('link')).toHaveLength(sourceKinds.length);
  }
);

test.stable(
  'places real document attachments in time order alongside plain notes and opens their material',
  async () => {
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
    const open = test.vi.fn();
    const view = mount(<History id={message.noteId} pages={[material]} onOpenPage={open} />);

    await test
      .within(view.container.querySelector('.note-history')!)
      .findByText('Before the document');
    const items = view.container.querySelectorAll('.note-entry, .workspace-desk-page');

    test.expect(items).toHaveLength(3);
    test.expect(items[0]).toHaveTextContent('Before the document');
    test.expect(items[1]).toHaveTextContent('Working page');
    test.expect(items[2]).toHaveTextContent('After the document');
    test.fireEvent.click(
      test.within(items[1]!.closest('.note-index-target')!).getByRole('button', {
        name: /Working page/
      })
    );
    test.expect(open).toHaveBeenCalledExactlyOnceWith(material);
  }
);

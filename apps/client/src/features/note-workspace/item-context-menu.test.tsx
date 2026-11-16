import { noteIdSchema, messagePartSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './attachment-cards';
import type * as __MockType2 from './note-page-card';

let authoredPage: typeof __MockType0.authoredPage;

let AttachmentCards: typeof __MockType1.AttachmentCards;

let NotePageCard: typeof __MockType2.NotePageCard;

let archiveHandler: ReturnType<typeof createMockState>['archiveHandler'];

function Provider({
  rpcHandlersTransport,
  children
}: Pick<test.unit.Context, 'rpcHandlersTransport'> & { children: React.ReactNode }) {
  const fixture = rpcHandlersTransport({
    'sources.source': async ({ id }) => ({
      id,
      name: 'Lecture.pdf',
      sizeBytes: 10n,
      kind: 'pdf',
      mime: 'application/pdf',
      origin: 'attachment',
      projectId: null,
      projectName: null,
      sha256: new Uint8Array(),
      uri: null,
      createdAt: 1n
    }),
    'notes.setItemArchived': (input) => archiveHandler(input)
  });

  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function createMockState(mock: test.Mock) {
  return {
    archiveHandler: mock.fn()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  archiveHandler = __mockState.archiveHandler;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english' })
  }));
  mock('#client/features/source-library', () => ({
    SourceDeletion: ({
      renderTrigger
    }: {
      renderTrigger?: (show: () => void, open: boolean) => unknown;
    }) => renderTrigger?.(() => {}, false) ?? null,
    SourceVersionDeletion: ({
      renderTrigger
    }: {
      renderTrigger?: (show: () => void, open: boolean) => unknown;
    }) => renderTrigger?.(() => {}, false) ?? null
  }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./attachment-cards');

  AttachmentCards = __mockModule1.AttachmentCards;
  const __mockModule2 = await import('./note-page-card');

  NotePageCard = __mockModule2.NotePageCard;
});

test.unit.afterEach(({ cleanup }) => cleanup());

test.unit.stable.for([false, true])(
  'opens the exact attachment from its context menu (compact: %s)',
  async (compact, { vi, render, screen, expect, fireEvent, userEvent, rpcHandlersTransport }) => {
    const open = vi.fn();
    const part = Schema.decodeUnknownSync(messagePartSchema)({
      id: 3n,
      sourceId: 7n,
      sourceName: 'Lecture.pdf',
      sourceKind: 'pdf'
    });

    render(
      <Provider rpcHandlersTransport={rpcHandlersTransport}>
        <AttachmentCards parts={[part]} compact={compact} onOpenSource={open} />
      </Provider>
    );
    await screen.findByRole('button', { name: 'Lecture.pdf' });
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lecture.pdf' })).toBeEnabled()
    );
    const card = screen.getByRole('button', { name: 'Lecture.pdf' });

    expect(screen.queryByRole('button', { name: 'NoteDeleteItem' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'NoteDeleteVersion' })).not.toBeInTheDocument();
    fireEvent.contextMenu(card, { button: 2, clientX: 80, clientY: 80 });
    expect(await screen.findByRole('menuitem', { name: 'NoteDeleteItem' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'NoteDeleteVersion' })).toBeVisible();
    expect(open).not.toHaveBeenCalled();
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'OpenMaterial' }));
    expect(open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: part.sourceId, name: 'Lecture.pdf', sizeBytes: 10n })
    );
  }
);

test.unit.stable(
  'opens the exact authored page from its context menu',
  async ({ vi, render, expect, screen, fireEvent, userEvent, rpcHandlersTransport }) => {
    const document = authoredPage();
    const open = vi.fn();

    render(
      <Provider rpcHandlersTransport={rpcHandlersTransport}>
        <NotePageCard page={document} active={false} onOpen={open} />
      </Provider>
    );
    expect(screen.queryByRole('button', { name: 'NoteDeleteItem' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'NoteDeleteVersion' })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('button', { name: /New page/ }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(open).not.toHaveBeenCalled();
    expect(await screen.findByRole('menuitem', { name: 'NoteDeleteItem' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'NoteDeleteVersion' })).toBeVisible();
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'NoteOpenPage' }));
    expect(open).toHaveBeenCalledExactlyOnceWith(document);
  }
);

test.unit.stable(
  'keeps unavailable attachment context actions disabled',
  async ({ render, vi, fireEvent, screen, expect, rpcHandlersTransport }) => {
    const part = Schema.decodeUnknownSync(messagePartSchema)({
      id: 3n,
      sourceId: null,
      sourceName: 'Missing.pdf',
      sourceKind: 'pdf'
    });

    render(
      <Provider rpcHandlersTransport={rpcHandlersTransport}>
        <AttachmentCards parts={[part]} onOpenSource={vi.fn()} />
      </Provider>
    );
    fireEvent.contextMenu(screen.getByText('Missing.pdf'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(await screen.findByRole('menuitem', { name: 'OpenMaterial' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  }
);

test.unit.stable.for(['page', 'source'] as const)(
  'archives the exact %s membership in this note',
  async (kind, { vi, render, screen, expect, fireEvent, userEvent, rpcHandlersTransport }) => {
    const noteId = Schema.decodeUnknownSync(noteIdSchema)(15n);
    const archive = vi.fn().mockResolvedValue(undefined);

    archiveHandler = archive;
    const document = authoredPage();
    const part = Schema.decodeUnknownSync(messagePartSchema)({
      id: 3n,
      sourceId: 7n,
      sourceName: 'Lecture.pdf',
      sourceKind: 'pdf'
    });

    render(
      <Provider rpcHandlersTransport={rpcHandlersTransport}>
        {kind === 'page' ? (
          <NotePageCard noteId={noteId} page={document} active={false} onOpen={vi.fn()} />
        ) : (
          <AttachmentCards noteId={noteId} parts={[part]} compact onOpenSource={vi.fn()} />
        )}
      </Provider>
    );
    const name = kind === 'page' ? /New page/ : 'Lecture.pdf';

    await screen.findByRole('button', { name });
    await vi.waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    const target = screen.getByRole('button', { name });

    fireEvent.contextMenu(target, { button: 2, clientX: 80, clientY: 80 });
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'NoteArchive' }));
    await vi.waitFor(() =>
      expect(archive).toHaveBeenCalledExactlyOnceWith({
        noteId,
        target: kind === 'page' ? { kind, id: document.id } : { kind, id: part.sourceId },
        archived: true
      })
    );
  }
);

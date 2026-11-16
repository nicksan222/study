import { noteIdSchema, messagePartSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { authoredPage } from '../document-editing/test-support';
import { AttachmentCards } from './attachment-cards';
import { NotePageCard } from './note-page-card';

test.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
test.mock('../source-library', () => ({
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

let archiveHandler = test.vi.fn();

function Provider({ children }: { children: React.ReactNode }) {
  const fixture = test.rpcHandlersTransport({
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

test.afterEach(test.cleanup);

test.stable.each([false, true])(
  'opens the exact attachment from its context menu (compact: %s)',
  async (compact) => {
    const open = test.vi.fn();
    const part = Schema.decodeUnknownSync(messagePartSchema)({
      id: 3n,
      sourceId: 7n,
      sourceName: 'Lecture.pdf',
      sourceKind: 'pdf'
    });

    test.render(
      <Provider>
        <AttachmentCards parts={[part]} compact={compact} onOpenSource={open} />
      </Provider>
    );
    await test.screen.findByRole('button', { name: 'Lecture.pdf' });
    await test.vi.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'Lecture.pdf' })).toBeEnabled()
    );
    const card = test.screen.getByRole('button', { name: 'Lecture.pdf' });

    test
      .expect(test.screen.queryByRole('button', { name: 'NoteDeleteItem' }))
      .not.toBeInTheDocument();
    test
      .expect(test.screen.queryByRole('button', { name: 'NoteDeleteVersion' }))
      .not.toBeInTheDocument();
    test.fireEvent.contextMenu(card, { button: 2, clientX: 80, clientY: 80 });
    test.expect(await test.screen.findByRole('menuitem', { name: 'NoteDeleteItem' })).toBeVisible();
    test.expect(test.screen.getByRole('menuitem', { name: 'NoteDeleteVersion' })).toBeVisible();
    test.expect(open).not.toHaveBeenCalled();
    await test.userEvent
      .setup()
      .click(await test.screen.findByRole('menuitem', { name: 'OpenMaterial' }));
    test
      .expect(open)
      .toHaveBeenCalledExactlyOnceWith(
        test.expect.objectContaining({ id: part.sourceId, name: 'Lecture.pdf', sizeBytes: 10n })
      );
  }
);

test.stable('opens the exact authored page from its context menu', async () => {
  const document = authoredPage();
  const open = test.vi.fn();

  test.render(
    <Provider>
      <NotePageCard page={document} active={false} onOpen={open} />
    </Provider>
  );
  test
    .expect(test.screen.queryByRole('button', { name: 'NoteDeleteItem' }))
    .not.toBeInTheDocument();
  test
    .expect(test.screen.queryByRole('button', { name: 'NoteDeleteVersion' }))
    .not.toBeInTheDocument();
  test.fireEvent.contextMenu(test.screen.getByRole('button', { name: /New page/ }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  test.expect(open).not.toHaveBeenCalled();
  test.expect(await test.screen.findByRole('menuitem', { name: 'NoteDeleteItem' })).toBeVisible();
  test.expect(test.screen.getByRole('menuitem', { name: 'NoteDeleteVersion' })).toBeVisible();
  await test.userEvent
    .setup()
    .click(await test.screen.findByRole('menuitem', { name: 'NoteOpenPage' }));
  test.expect(open).toHaveBeenCalledExactlyOnceWith(document);
});

test.stable('keeps unavailable attachment context actions disabled', async () => {
  const part = Schema.decodeUnknownSync(messagePartSchema)({
    id: 3n,
    sourceId: null,
    sourceName: 'Missing.pdf',
    sourceKind: 'pdf'
  });

  test.render(
    <Provider>
      <AttachmentCards parts={[part]} onOpenSource={test.vi.fn()} />
    </Provider>
  );
  test.fireEvent.contextMenu(test.screen.getByText('Missing.pdf'), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  test
    .expect(await test.screen.findByRole('menuitem', { name: 'OpenMaterial' }))
    .toHaveAttribute('aria-disabled', 'true');
});

test.stable.each(['page', 'source'] as const)(
  'archives the exact %s membership in this note',
  async (kind) => {
    const noteId = Schema.decodeUnknownSync(noteIdSchema)(15n);
    const archive = test.vi.fn().mockResolvedValue(undefined);

    archiveHandler = archive;
    const document = authoredPage();
    const part = Schema.decodeUnknownSync(messagePartSchema)({
      id: 3n,
      sourceId: 7n,
      sourceName: 'Lecture.pdf',
      sourceKind: 'pdf'
    });

    test.render(
      <Provider>
        {kind === 'page' ? (
          <NotePageCard noteId={noteId} page={document} active={false} onOpen={test.vi.fn()} />
        ) : (
          <AttachmentCards noteId={noteId} parts={[part]} compact onOpenSource={test.vi.fn()} />
        )}
      </Provider>
    );
    const name = kind === 'page' ? /New page/ : 'Lecture.pdf';

    await test.screen.findByRole('button', { name });
    await test.vi.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name })).toBeEnabled()
    );
    const target = test.screen.getByRole('button', { name });

    test.fireEvent.contextMenu(target, { button: 2, clientX: 80, clientY: 80 });
    await test.userEvent
      .setup()
      .click(await test.screen.findByRole('menuitem', { name: 'NoteArchive' }));
    await test.vi.waitFor(() =>
      test.expect(archive).toHaveBeenCalledExactlyOnceWith({
        noteId,
        target: kind === 'page' ? { kind, id: document.id } : { kind, id: part.sourceId },
        archived: true
      })
    );
  }
);

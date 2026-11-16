import { noteIdSchema, messagePartSchema } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { AttachmentCards } from './attachment-cards';
import { NotePageCard } from './note-page-card';

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
vi.mock('../source-library', () => ({
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

let archiveHandler = vi.fn();

function Provider({ children }: { children: React.ReactNode }) {
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

afterEach(cleanup);

testStable.each([false, true])(
  'opens the exact attachment from its context menu (compact: %s)',
  async (compact) => {
    const open = vi.fn();
    const part = Schema.decodeUnknownSync(messagePartSchema)({
      id: 3n,
      sourceId: 7n,
      sourceName: 'Lecture.pdf',
      sourceKind: 'pdf'
    });

    render(
      <Provider>
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

testStable('opens the exact authored page from its context menu', async () => {
  const document = authoredPage();
  const open = vi.fn();

  render(
    <Provider>
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
});

testStable('keeps unavailable attachment context actions disabled', async () => {
  const part = Schema.decodeUnknownSync(messagePartSchema)({
    id: 3n,
    sourceId: null,
    sourceName: 'Missing.pdf',
    sourceKind: 'pdf'
  });

  render(
    <Provider>
      <AttachmentCards parts={[part]} onOpenSource={vi.fn()} />
    </Provider>
  );
  fireEvent.contextMenu(screen.getByText('Missing.pdf'), { button: 2, clientX: 80, clientY: 80 });
  expect(await screen.findByRole('menuitem', { name: 'OpenMaterial' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
});

testStable.each(['page', 'source'] as const)(
  'archives the exact %s membership in this note',
  async (kind) => {
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
      <Provider>
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

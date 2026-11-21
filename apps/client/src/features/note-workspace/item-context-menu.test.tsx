import { noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType2 from './note-page-card';

let authoredPage: typeof __MockType0.authoredPage;

let NotePageCard: typeof __MockType2.NotePageCard;

let archiveHandler: ReturnType<typeof createMockState>['archiveHandler'];

function Provider({
  rpcHandlersTransport,
  children
}: Pick<test.unit.Context, 'rpcHandlersTransport'> & { children: React.ReactNode }) {
  const fixture = rpcHandlersTransport({
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
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule2 = await import('./note-page-card');

  NotePageCard = __mockModule2.NotePageCard;
});

test.unit.afterEach(({ cleanup }) => cleanup());

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
  'archives the exact authored page membership in this note',
  async ({ vi, render, screen, expect, fireEvent, userEvent, rpcHandlersTransport }) => {
    const noteId = Schema.decodeUnknownSync(noteIdSchema)(15n);
    const archive = vi.fn().mockResolvedValue(undefined);

    archiveHandler = archive;
    const document = authoredPage();

    render(
      <Provider rpcHandlersTransport={rpcHandlersTransport}>
        <NotePageCard noteId={noteId} page={document} active={false} onOpen={vi.fn()} />
      </Provider>
    );
    const name = /New page/;

    await screen.findByRole('button', { name });
    await vi.waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    const target = screen.getByRole('button', { name });

    fireEvent.contextMenu(target, { button: 2, clientX: 80, clientY: 80 });
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'NoteArchive' }));
    await vi.waitFor(() =>
      expect(archive).toHaveBeenCalledExactlyOnceWith({
        noteId,
        target: { kind: 'page', id: document.id },
        archived: true
      })
    );
  }
);

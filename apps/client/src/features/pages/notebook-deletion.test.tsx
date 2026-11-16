import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { PageNotebookDeletion } from '../document-editing';
import { authoredPage } from '../document-editing/test-support';
import { ItemContextMenu } from '../note-workspace/item-context-menu';
import { ItemDeletionMenu } from '../note-workspace/item-deletion-menu';

const en = catalogs.english;

test.afterEach(({ cleanup, vi }) => {
  cleanup();

  vi.clearAllMocks();
});

test.stable(
  'confirms one authored note revision separately from the full item',
  async ({
    vi,
    rpcHandlersTransport,
    render,
    userEvent,
    expect,
    screen,
    fireEvent,
    within,
    waitFor
  }) => {
    const document = authoredPage(41n, 'Current', 102n);
    const old = { ...authoredPage(41n, 'Old', 101n).version!, number: 1n };
    const current = { ...document.version!, number: 2n };
    const impact = {
      pageId: document.id,
      token: 'preview',
      versionIds: [old.id],
      blockedVersionIds: [],
      semantics: 'retire_bodies_retain_identities' as const
    };
    const retire = vi.fn().mockResolvedValue(impact);
    const remove = vi.fn().mockResolvedValue(undefined);
    const rpc = {
      'pages.versions': async () => ({ items: [current, old], nextCursor: null }),
      'pages.previewHistory': async () => impact,
      'pages.previewDeletion': async () => ({ ...impact, versionIds: [old.id, current.id] }),
      'pages.retireHistory': retire,
      'pages.delete': remove
    };

    const harness = rpcHandlersTransport(rpc);

    render(
      <harness.wrapper>
        <PageNotebookDeletion
          page={document}
          renderActions={(actions) => (
            <ItemContextMenu
              target={<button type="button" aria-label="OpenMaterial" />}
              label="OpenMaterial"
              dialogOpen={actions.open}
              actions={<ItemDeletionMenu {...actions} />}
            >
              <button type="button">Page</button>
            </ItemContextMenu>
          )}
        />
      </harness.wrapper>
    );
    const user = userEvent.setup();

    expect(screen.queryByRole('button', { name: en.NoteDeleteVersion })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Page' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    await user.click(await screen.findByRole('menuitem', { name: en.NoteDeleteVersion }));
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: en.NoteDeleteVersion })
    ).not.toBeInTheDocument();
    expect(
      await within(dialog).findByRole('button', { name: new RegExp(en.ReaderVersion + ' 2') })
    ).toBeDisabled();
    await user.click(
      await within(dialog).findByRole('button', { name: new RegExp(en.ReaderVersion + ' 1') })
    );
    const input = within(dialog).getByRole('textbox');

    await waitFor(() => expect(input).toBeEnabled());
    expect(retire).not.toHaveBeenCalled();
    await user.type(input, document.title);
    await user.click(within(dialog).getByRole('button', { name: en.NoteDeleteVersion }));
    await waitFor(() =>
      expect(retire).toHaveBeenCalledExactlyOnceWith({
        pageId: document.id,
        keepLatest: 1,
        versionId: old.id,
        token: impact.token
      })
    );
    expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Page' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    await user.click(await screen.findByRole('menuitem', { name: en.NoteDeleteItem }));
    const entire = await screen.findByRole('alertdialog');
    const name = within(entire).getByRole('textbox');

    await waitFor(() => expect(name).toBeEnabled());
    await user.type(name, document.title);
    await user.click(within(entire).getByRole('button', { name: en.NoteDeleteItem }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledExactlyOnceWith({ pageId: document.id, token: impact.token })
    );
  }
);

test.stable(
  'shows a review-only list when the current version is the only version',
  async ({ rpcHandlersTransport, render, userEvent, screen, expect, within }) => {
    const document = authoredPage(41n, 'Only version', 101n);
    const rpc = {
      'pages.versions': async () => ({ items: [document.version!], nextCursor: null })
    };

    const harness = rpcHandlersTransport(rpc);

    render(
      <harness.wrapper>
        <PageNotebookDeletion page={document} />
      </harness.wrapper>
    );
    await userEvent.setup().click(screen.getByRole('button', { name: en.NoteDeleteVersion }));
    const dialog = await screen.findByRole('alertdialog', { name: en.NoteDeleteChooseVersion });

    expect(await within(dialog).findByText(en.NoteDeleteNoOlderVersions)).toBeVisible();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: en.NoteDeleteVersion })
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: new RegExp(en.ReaderVersion) })
    ).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: en.Cancel })).toBeEnabled();
  }
);

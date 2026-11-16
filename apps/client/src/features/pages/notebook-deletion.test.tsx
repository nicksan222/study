import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { PageNotebookDeletion } from '../document-editing';
import { authoredPage } from '../document-editing/test-support';
import { ItemContextMenu } from '../note-workspace/item-context-menu';
import { ItemDeletionMenu } from '../note-workspace/item-deletion-menu';

const en = catalogs.english;

test.afterEach(() => {
  test.cleanup();

  test.vi.clearAllMocks();
});

test.stable('confirms one authored note revision separately from the full item', async () => {
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
  const retire = test.vi.fn().mockResolvedValue(impact);
  const remove = test.vi.fn().mockResolvedValue(undefined);
  const rpc = {
    'pages.versions': async () => ({ items: [current, old], nextCursor: null }),
    'pages.previewHistory': async () => impact,
    'pages.previewDeletion': async () => ({ ...impact, versionIds: [old.id, current.id] }),
    'pages.retireHistory': retire,
    'pages.delete': remove
  };

  const harness = test.rpcHandlersTransport(rpc);

  test.render(
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
  const user = test.userEvent.setup();

  test
    .expect(test.screen.queryByRole('button', { name: en.NoteDeleteVersion }))
    .not.toBeInTheDocument();
  test.fireEvent.contextMenu(test.screen.getByRole('button', { name: 'Page' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  await user.click(await test.screen.findByRole('menuitem', { name: en.NoteDeleteVersion }));
  const dialog = await test.screen.findByRole('alertdialog');

  test.expect(test.within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  test
    .expect(test.within(dialog).queryByRole('button', { name: en.NoteDeleteVersion }))
    .not.toBeInTheDocument();
  test
    .expect(
      await test.within(dialog).findByRole('button', { name: new RegExp(en.ReaderVersion + ' 2') })
    )
    .toBeDisabled();
  await user.click(
    await test.within(dialog).findByRole('button', { name: new RegExp(en.ReaderVersion + ' 1') })
  );
  const input = test.within(dialog).getByRole('textbox');

  await test.waitFor(() => test.expect(input).toBeEnabled());
  test.expect(retire).not.toHaveBeenCalled();
  await user.type(input, document.title);
  await user.click(test.within(dialog).getByRole('button', { name: en.NoteDeleteVersion }));
  await test.waitFor(() =>
    test.expect(retire).toHaveBeenCalledExactlyOnceWith({
      pageId: document.id,
      keepLatest: 1,
      versionId: old.id,
      token: impact.token
    })
  );
  test.expect(remove).not.toHaveBeenCalled();
  await test.waitFor(() =>
    test.expect(test.screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  );
  test.fireEvent.contextMenu(test.screen.getByRole('button', { name: 'Page' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  await user.click(await test.screen.findByRole('menuitem', { name: en.NoteDeleteItem }));
  const entire = await test.screen.findByRole('alertdialog');
  const name = test.within(entire).getByRole('textbox');

  await test.waitFor(() => test.expect(name).toBeEnabled());
  await user.type(name, document.title);
  await user.click(test.within(entire).getByRole('button', { name: en.NoteDeleteItem }));
  await test.waitFor(() =>
    test
      .expect(remove)
      .toHaveBeenCalledExactlyOnceWith({ pageId: document.id, token: impact.token })
  );
});

test.stable('shows a review-only list when the current version is the only version', async () => {
  const document = authoredPage(41n, 'Only version', 101n);
  const rpc = {
    'pages.versions': async () => ({ items: [document.version!], nextCursor: null })
  };

  const harness = test.rpcHandlersTransport(rpc);

  test.render(
    <harness.wrapper>
      <PageNotebookDeletion page={document} />
    </harness.wrapper>
  );
  await test.userEvent
    .setup()
    .click(test.screen.getByRole('button', { name: en.NoteDeleteVersion }));
  const dialog = await test.screen.findByRole('alertdialog', { name: en.NoteDeleteChooseVersion });

  test.expect(await test.within(dialog).findByText(en.NoteDeleteNoOlderVersions)).toBeVisible();
  test.expect(test.within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  test
    .expect(test.within(dialog).queryByRole('button', { name: en.NoteDeleteVersion }))
    .not.toBeInTheDocument();
  test
    .expect(test.within(dialog).getByRole('button', { name: new RegExp(en.ReaderVersion) }))
    .toBeDisabled();
  test.expect(test.within(dialog).getByRole('button', { name: en.Cancel })).toBeEnabled();
});

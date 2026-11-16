import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { authoredPage } from '../document-editing/test-support';
import { importedSource } from '../material-library/test/support';
import { ItemContextMenu } from '../note-workspace/item-context-menu';
import { ItemDeletionMenu } from '../note-workspace/item-deletion-menu';
import { SourceVersionDeletion } from './version-deletion';

const en = catalogs.english;

test.afterEach(() => {
  test.cleanup();

  test.vi.clearAllMocks();
});

test.stable('reviews and deletes only the chosen attachment version', async () => {
  const snapshotId = authoredPage(41n, 'Old extraction', 1101n).version!.snapshotId;
  const candidate = { sourceId: importedSource.id, revision: 1n, snapshotId, createdAt: 1n };
  const impact = {
    sourceId: importedSource.id,
    snapshotId,
    keepLatest: 1,
    name: importedSource.name,
    token: 'b'.repeat(64),
    candidates: [candidate],
    blockedSnapshotIds: [],
    semantics: 'retire_extractions_keep_original_revisions' as const
  };
  const preview = test.vi.fn().mockResolvedValue(impact);
  const remove = test.vi.fn().mockResolvedValue(impact);
  const rpc = {
    'sources.extractions': async () => ({
      items: [
        {
          ...candidate,
          snapshotId: authoredPage(41n, 'Current', 1201n).version!.snapshotId,
          createdAt: 2n
        },
        candidate
      ],
      next: null
    }),
    'sources.previewHistory': preview,
    'sources.retireHistory': remove
  };

  const harness = test.rpcHandlersTransport(rpc);

  const removed = test.vi.fn();

  test.render(
    <harness.wrapper>
      <SourceVersionDeletion
        source={importedSource}
        onDeleted={removed}
        renderTrigger={(onDeleteVersion, open) => (
          <ItemContextMenu
            target={<button type="button" aria-label="OpenMaterial" />}
            label="OpenMaterial"
            dialogOpen={open}
            actions={
              <ItemDeletionMenu
                onDeleteItem={test.vi.fn()}
                onDeleteVersion={onDeleteVersion}
                open={open}
              />
            }
          >
            <button type="button">Attachment</button>
          </ItemContextMenu>
        )}
      />
    </harness.wrapper>
  );
  const user = test.userEvent.setup();

  test
    .expect(test.screen.queryByRole('button', { name: en.NoteDeleteVersion }))
    .not.toBeInTheDocument();
  test.fireEvent.contextMenu(test.screen.getByRole('button', { name: 'Attachment' }), {
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
  const versions = await test.within(dialog).findAllByRole('button', {
    name: new RegExp(en.ReaderVersion)
  });

  await user.click(versions.at(-1)!);
  await test.waitFor(() =>
    test.expect(preview).toHaveBeenLastCalledWith({
      sourceId: importedSource.id,
      keepLatest: 1,
      snapshotId
    })
  );
  const input = test.within(dialog).getByRole('textbox');

  await test.waitFor(() => test.expect(input).toBeEnabled());
  test.expect(remove).not.toHaveBeenCalled();
  await user.type(input, importedSource.name);
  await user.click(test.within(dialog).getByRole('button', { name: en.NoteDeleteVersion }));
  await test.waitFor(() =>
    test.expect(remove).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      keepLatest: 1,
      snapshotId,
      token: impact.token
    })
  );
  await test.waitFor(() => test.expect(removed).toHaveBeenCalledOnce());
});

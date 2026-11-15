import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { importedSource } from '../material-library/test/support';
import { ItemContextMenu } from '../note-workspace/item-context-menu';
import { ItemDeletionMenu } from '../note-workspace/item-deletion-menu';
import { SourceVersionDeletion } from './version-deletion';

const en = catalogs.english;

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

testStable('reviews and deletes only the chosen attachment version', async () => {
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
  const preview = vi.fn().mockResolvedValue(impact);
  const remove = vi.fn().mockResolvedValue(impact);
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

  const harness = rpcHandlersTransport(rpc);

  const removed = vi.fn();

  render(
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
                onDeleteItem={vi.fn()}
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
  const user = userEvent.setup();

  expect(screen.queryByRole('button', { name: en.NoteDeleteVersion })).not.toBeInTheDocument();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Attachment' }), {
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
  const versions = await within(dialog).findAllByRole('button', {
    name: new RegExp(en.ReaderVersion)
  });

  await user.click(versions.at(-1)!);
  await waitFor(() =>
    expect(preview).toHaveBeenLastCalledWith({
      sourceId: importedSource.id,
      keepLatest: 1,
      snapshotId
    })
  );
  const input = within(dialog).getByRole('textbox');

  await waitFor(() => expect(input).toBeEnabled());
  expect(remove).not.toHaveBeenCalled();
  await user.type(input, importedSource.name);
  await user.click(within(dialog).getByRole('button', { name: en.NoteDeleteVersion }));
  await waitFor(() =>
    expect(remove).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      keepLatest: 1,
      snapshotId,
      token: impact.token
    })
  );
  await waitFor(() => expect(removed).toHaveBeenCalledOnce());
});

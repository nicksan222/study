import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vite-plus/test';

import { request } from '#web/lib/study-client/request.ts';

import { authoredDocument } from '../document-editing/test-support';
import { importedSource } from '../material-library/test/support';
import { ItemContextMenu } from '../session-workspace/item-context-menu';
import { ItemDeletionMenu } from '../session-workspace/item-deletion-menu';
import { SourceVersionDeletion } from './version-deletion';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
const en = catalogs.english;
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});

testStable('reviews and deletes only the chosen attachment version', async () => {
  const snapshotId = authoredDocument(41n, 'Old extraction', 1101n).version!.snapshotId;
  const candidate = { sourceId: importedSource.id, revision: 1n, snapshotId, createdAt: 1n };
  const impact = {
    sourceId: importedSource.id,
    snapshotId,
    keepLatest: 1,
    name: importedSource.name,
    token: 'b'.repeat(64),
    candidates: [candidate],
    blockedSnapshotIds: [],
    semantics: 'retire_extractions_keep_original_revisions'
  };
  const preview = vi.fn().mockResolvedValue(impact);
  const remove = vi.fn().mockResolvedValue(impact);
  const rpc = {
    'sources.extractions': async () => ({
      items: [
        {
          ...candidate,
          snapshotId: authoredDocument(41n, 'Current', 1201n).version!.snapshotId,
          createdAt: 2n
        },
        candidate
      ],
      next: null
    }),
    'sources.previewHistory': preview,
    'sources.retireHistory': remove
  };
  vi.mocked(request).mockImplementation(async (invoke) => invoke(rpc as never));
  const client = new QueryClient();
  clients.push(client);
  const removed = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <SourceVersionDeletion
        source={importedSource}
        onDeleted={removed}
        renderTrigger={(onDeleteVersion, open) => (
          <ItemContextMenu
            target={<button type="button" />}
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
    </QueryClientProvider>
  );
  const user = userEvent.setup();
  expect(screen.queryByRole('button', { name: en.SessionDeleteVersion })).not.toBeInTheDocument();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Attachment' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  await user.click(await screen.findByRole('menuitem', { name: en.SessionDeleteVersion }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole('button', { name: en.SessionDeleteVersion })
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
  await user.click(within(dialog).getByRole('button', { name: en.SessionDeleteVersion }));
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

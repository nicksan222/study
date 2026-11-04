import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vite-plus/test';

import { request } from '#web/lib/study-client/request.ts';

import { DocumentNotebookDeletion } from '../document-editing';
import { authoredDocument } from '../document-editing/test-support';
import { ItemContextMenu } from '../session-workspace/item-context-menu';
import { ItemDeletionMenu } from '../session-workspace/item-deletion-menu';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const en = catalogs.english;

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});

testStable('confirms one authored note revision separately from the full item', async () => {
  const document = authoredDocument(41n, 'Current', 102n);
  const old = { ...authoredDocument(41n, 'Old', 101n).version!, number: 1n };
  const current = { ...document.version!, number: 2n };
  const impact = {
    documentId: document.id,
    token: 'preview',
    versionIds: [old.id],
    blockedVersionIds: [],
    semantics: 'retire_bodies_retain_identities'
  };
  const retire = vi.fn().mockResolvedValue(impact);
  const remove = vi.fn().mockResolvedValue(undefined);
  const rpc = {
    'documents.versions': async () => ({ items: [current, old], nextCursor: null }),
    'documents.previewHistory': async () => impact,
    'documents.previewDeletion': async () => ({ ...impact, versionIds: [old.id, current.id] }),
    'documents.retireHistory': retire,
    'documents.delete': remove
  };

  vi.mocked(request).mockImplementation(async (invoke) => invoke(rpc as never));
  const client = new QueryClient();

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <DocumentNotebookDeletion
        document={document}
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
    </QueryClientProvider>
  );
  const user = userEvent.setup();

  expect(screen.queryByRole('button', { name: en.SessionDeleteVersion })).not.toBeInTheDocument();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Page' }), {
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
  await user.click(within(dialog).getByRole('button', { name: en.SessionDeleteVersion }));
  await waitFor(() =>
    expect(retire).toHaveBeenCalledExactlyOnceWith({
      documentId: document.id,
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
  await user.click(await screen.findByRole('menuitem', { name: en.SessionDeleteItem }));
  const entire = await screen.findByRole('alertdialog');
  const name = within(entire).getByRole('textbox');

  await waitFor(() => expect(name).toBeEnabled());
  await user.type(name, document.title);
  await user.click(within(entire).getByRole('button', { name: en.SessionDeleteItem }));
  await waitFor(() =>
    expect(remove).toHaveBeenCalledExactlyOnceWith({ documentId: document.id, token: impact.token })
  );
});

testStable('shows a review-only list when the current version is the only version', async () => {
  const document = authoredDocument(41n, 'Only version', 101n);
  const rpc = {
    'documents.versions': async () => ({ items: [document.version!], nextCursor: null })
  };

  vi.mocked(request).mockImplementation(async (invoke) => invoke(rpc as never));
  const client = new QueryClient();

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <DocumentNotebookDeletion document={document} />
    </QueryClientProvider>
  );
  await userEvent.setup().click(screen.getByRole('button', { name: en.SessionDeleteVersion }));
  const dialog = await screen.findByRole('alertdialog', { name: en.SessionDeleteChooseVersion });

  expect(await within(dialog).findByText(en.SessionDeleteNoOlderVersions)).toBeVisible();
  expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole('button', { name: en.SessionDeleteVersion })
  ).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: new RegExp(en.ReaderVersion) })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: en.Cancel })).toBeEnabled();
});

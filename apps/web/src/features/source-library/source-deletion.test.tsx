import { StudyError } from '@study/contracts/errors';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Option } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { authoredDocument } from '../document-editing/test-support';
import {
  importedSource,
  locationIs,
  materialRpc,
  mountLibraryRoute
} from '../material-library/test/support';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

async function openDeletion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: catalogs.english.SourceDeleteTitle }));
  return screen.findByRole('alertdialog');
}

testStable(
  'previews source revisions and requires its exact name before deleting, releasing only source caches',
  async () => {
    const rpc = materialRpc();
    rpc['sources.deleteSource'].mockImplementation(() =>
      Effect.sync(() => {
        rpc['sources.source'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Deleted')));
        return true;
      })
    );
    const { router, queryClient } = mountLibraryRoute(
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );
    const independent = authoredDocument(41n);
    queryClient.setQueryData(['documents', 'detail', '41'], independent);
    const user = userEvent.setup();
    const dialog = await openDeletion(user);
    expect(
      await within(dialog).findByText(`${catalogs.english.SourceDeleteRevisions}: 1`)
    ).toBeInTheDocument();
    expect(within(dialog).getByText(catalogs.english.SourceDeleteHelp)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', {
      name: catalogs.english.SourceDeleteConfirm
    });
    expect(confirm).toBeDisabled();
    const name = within(dialog).getByRole('textbox', { name: catalogs.english.SourceDeleteName });
    await waitFor(() => expect(name).toBeEnabled());
    await user.type(name, importedSource.name);
    await user.click(confirm);
    await locationIs(router, '/library');
    expect(rpc['sources.deleteSource']).toHaveBeenCalledExactlyOnceWith({ id: importedSource.id });
    expect(rpc['sources.findSource']).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['documents', 'detail', '41'])).toBe(independent);
    expect(queryClient.getQueryData(['sources', 'extraction', '7', '1', '1101'])).toBeUndefined();
  }
);

testStable(
  'keeps exact input pins visible and disables deletion without hiding retained source content',
  async () => {
    const rpc = materialRpc();
    rpc['sources.previewDeletion'].mockReturnValue(
      Effect.succeed({
        sourceId: importedSource.id,
        name: importedSource.name,
        revisionCount: 2n,
        extractionCount: 3n,
        blockedBy: ['exact_inputs', 'image_assets'],
        retainedCopies: 'authored_outputs_and_raw_session_records'
      })
    );
    mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    const user = userEvent.setup();
    const dialog = await openDeletion(user);
    expect(
      await within(dialog).findByText(catalogs.english.SourceDeleteExactPins)
    ).toBeInTheDocument();
    expect(within(dialog).getByText(catalogs.english.SourceDeleteImagePins)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('textbox', { name: catalogs.english.SourceDeleteName })
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: catalogs.english.SourceDeleteConfirm })
    ).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: catalogs.english.Cancel }));
    expect(screen.getByText('Historical extraction')).toBeInTheDocument();
    expect(rpc['sources.deleteSource']).not.toHaveBeenCalled();
  }
);

testStable(
  'recovers a lost deletion response through durable source absence and returns to the Library',
  async () => {
    const rpc = materialRpc();
    rpc['sources.deleteSource'].mockReturnValue(
      Effect.fail(new StudyError('transient', 'Lost response'))
    );
    rpc['sources.findSource'].mockImplementation(() =>
      Effect.sync(() => {
        rpc['sources.source'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Deleted')));
        return Option.none();
      })
    );
    const { router } = mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    const user = userEvent.setup();
    const dialog = await openDeletion(user);
    const name = within(dialog).getByRole('textbox', { name: catalogs.english.SourceDeleteName });
    await waitFor(() => expect(name).toBeEnabled());
    await user.type(name, importedSource.name);
    await user.click(
      within(dialog).getByRole('button', { name: catalogs.english.SourceDeleteConfirm })
    );
    await locationIs(router, '/library');
    expect(rpc['sources.findSource']).toHaveBeenCalledExactlyOnceWith({ id: importedSource.id });
    expect(rpc['sources.deleteSource']).toHaveBeenCalledTimes(1);
  }
);

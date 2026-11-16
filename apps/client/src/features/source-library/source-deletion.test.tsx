import { StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Option } from 'effect';

import {
  importedSource,
  locationIs,
  materialRpc,
  mountLibraryRoute
} from '../material-library/test/support';

async function openDeletion(
  { screen }: Pick<test.Context, 'screen'>,
  user: ReturnType<test.Context['userEvent']['setup']>
) {
  await user.click(await screen.findByRole('button', { name: catalogs.english.SourceDeleteTitle }));

  return screen.findByRole('alertdialog');
}

test.stable(
  'previews source revisions and requires its exact name before deleting while preserving unrelated authored content',
  async ({ userEvent, expect, within, waitFor, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = materialRpc({ vi });

    rpc['sources.deleteSource'].mockImplementation(() =>
      Effect.sync(() => {
        rpc['sources.source'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Deleted')));

        return true;
      })
    );
    const { router } = mountLibraryRoute(
      { render, rpcHandlersTransport, vi },
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );

    const user = userEvent.setup();
    const dialog = await openDeletion({ screen }, user);

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
    await locationIs({ waitFor }, router, '/notes');
    expect(rpc['sources.deleteSource']).toHaveBeenCalledExactlyOnceWith({ id: importedSource.id });
    expect(rpc['sources.findSource']).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps exact input pins visible and disables deletion without hiding retained source content',
  async ({ userEvent, expect, within, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = materialRpc({ vi });

    rpc['sources.previewDeletion'].mockReturnValue(
      Effect.succeed({
        sourceId: importedSource.id,
        name: importedSource.name,
        revisionCount: 2n,
        extractionCount: 3n,
        blockedBy: ['exact_inputs', 'image_assets'],
        retainedCopies: 'authored_outputs_and_raw_note_records'
      })
    );
    mountLibraryRoute(
      { render, rpcHandlersTransport, vi },
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );
    const user = userEvent.setup();
    const dialog = await openDeletion({ screen }, user);

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

test.stable(
  'recovers a lost deletion response through durable source absence and returns to Notes',
  async ({ userEvent, within, waitFor, expect, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = materialRpc({ vi });

    rpc['sources.deleteSource'].mockReturnValue(
      Effect.fail(new StudyError('transient', 'Lost response'))
    );
    rpc['sources.findSource'].mockImplementation(() =>
      Effect.sync(() => {
        rpc['sources.source'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Deleted')));

        return Option.none();
      })
    );
    const { router } = mountLibraryRoute(
      { render, rpcHandlersTransport, vi },
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );
    const user = userEvent.setup();
    const dialog = await openDeletion({ screen }, user);
    const name = within(dialog).getByRole('textbox', { name: catalogs.english.SourceDeleteName });

    await waitFor(() => expect(name).toBeEnabled());
    await user.type(name, importedSource.name);
    await user.click(
      within(dialog).getByRole('button', { name: catalogs.english.SourceDeleteConfirm })
    );
    await locationIs({ waitFor }, router, '/notes');
    expect(rpc['sources.findSource']).toHaveBeenCalledExactlyOnceWith({ id: importedSource.id });
    expect(rpc['sources.deleteSource']).toHaveBeenCalledTimes(1);
  }
);

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

async function openDeletion(user: ReturnType<typeof test.userEvent.setup>) {
  await user.click(
    await test.screen.findByRole('button', { name: catalogs.english.SourceDeleteTitle })
  );

  return test.screen.findByRole('alertdialog');
}

test.stable(
  'previews source revisions and requires its exact name before deleting while preserving unrelated authored content',
  async () => {
    const rpc = materialRpc();

    rpc['sources.deleteSource'].mockImplementation(() =>
      Effect.sync(() => {
        rpc['sources.source'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Deleted')));

        return true;
      })
    );
    const { router } = mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);

    const user = test.userEvent.setup();
    const dialog = await openDeletion(user);

    test
      .expect(await test.within(dialog).findByText(`${catalogs.english.SourceDeleteRevisions}: 1`))
      .toBeInTheDocument();
    test
      .expect(test.within(dialog).getByText(catalogs.english.SourceDeleteHelp))
      .toBeInTheDocument();
    const confirm = test.within(dialog).getByRole('button', {
      name: catalogs.english.SourceDeleteConfirm
    });

    test.expect(confirm).toBeDisabled();
    const name = test
      .within(dialog)
      .getByRole('textbox', { name: catalogs.english.SourceDeleteName });

    await test.waitFor(() => test.expect(name).toBeEnabled());
    await user.type(name, importedSource.name);
    await user.click(confirm);
    await locationIs(router, '/notes');
    test
      .expect(rpc['sources.deleteSource'])
      .toHaveBeenCalledExactlyOnceWith({ id: importedSource.id });
    test.expect(rpc['sources.findSource']).not.toHaveBeenCalled();
  }
);

test.stable(
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
        retainedCopies: 'authored_outputs_and_raw_note_records'
      })
    );
    mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    const user = test.userEvent.setup();
    const dialog = await openDeletion(user);

    test
      .expect(await test.within(dialog).findByText(catalogs.english.SourceDeleteExactPins))
      .toBeInTheDocument();
    test
      .expect(test.within(dialog).getByText(catalogs.english.SourceDeleteImagePins))
      .toBeInTheDocument();
    test
      .expect(test.within(dialog).getByRole('textbox', { name: catalogs.english.SourceDeleteName }))
      .toBeDisabled();
    test
      .expect(
        test.within(dialog).getByRole('button', { name: catalogs.english.SourceDeleteConfirm })
      )
      .toBeDisabled();
    await user.click(test.within(dialog).getByRole('button', { name: catalogs.english.Cancel }));
    test.expect(test.screen.getByText('Historical extraction')).toBeInTheDocument();
    test.expect(rpc['sources.deleteSource']).not.toHaveBeenCalled();
  }
);

test.stable(
  'recovers a lost deletion response through durable source absence and returns to Notes',
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
    const user = test.userEvent.setup();
    const dialog = await openDeletion(user);
    const name = test
      .within(dialog)
      .getByRole('textbox', { name: catalogs.english.SourceDeleteName });

    await test.waitFor(() => test.expect(name).toBeEnabled());
    await user.type(name, importedSource.name);
    await user.click(
      test.within(dialog).getByRole('button', { name: catalogs.english.SourceDeleteConfirm })
    );
    await locationIs(router, '/notes');
    test
      .expect(rpc['sources.findSource'])
      .toHaveBeenCalledExactlyOnceWith({ id: importedSource.id });
    test.expect(rpc['sources.deleteSource']).toHaveBeenCalledTimes(1);
  }
);

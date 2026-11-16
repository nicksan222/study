import {
  StudyError,
  materialDeletionPreviewSchema,
  materialDeletionSchema,
  materialVersionDetailSchema,
  materialVersionSummarySchema,
  defaultWorkspacePreferences
} from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { materialId, versionId } from './identity';
import { learningVersion, materialRpc, mountLibraryRoute } from './test/support';

test.stable(
  'rejects a foreign Material version before rendering extraction or exposing its original',
  async () => {
    const rpc = materialRpc();

    rpc['materials.materialVersion'].mockReturnValue(Effect.succeed(learningVersion(101n, 99n)));
    mountLibraryRoute('/materials/41?version=101', rpc);
    test
      .expect(await test.within(await test.screen.findByRole('main')).findByRole('alert'))
      .toHaveTextContent(catalogs.english.ReaderUnavailable);
    test.expect(test.screen.queryByText(/Historical extraction/)).toBeNull();
    test.expect(test.screen.queryByText(/Current extraction 41/)).toBeNull();
    test
      .expect(test.screen.queryByRole('button', { name: catalogs.english.ReaderOriginal }))
      .toBeNull();
    test.expect(rpc['materials.materialVersion']).toHaveBeenCalledExactlyOnceWith({
      id: versionId('101')
    });
    test.expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
  }
);

test.stable(
  'loads history only on opening, refreshes the bounded prefix and preserves collection on selection',
  async () => {
    const rpc = materialRpc();
    const decode = Schema.decodeUnknownSync(materialVersionSummarySchema);
    const current = decode(learningVersion(102n));
    const old = decode({ ...learningVersion(), availability: 'unavailable' });

    rpc['materials.materialVersions']
      .mockReturnValueOnce(Effect.succeed({ items: [current], nextCursor: versionId('102') }))
      .mockReturnValueOnce(Effect.succeed({ items: [current, old], nextCursor: null }));
    rpc['materials.materialVersion'].mockImplementation(({ id }) =>
      id === versionId('101')
        ? Effect.fail(new StudyError('not_found', 'Historical version unavailable'))
        : Effect.succeed(learningVersion(102n, 41n, 'Current extraction 41'))
    );
    const { router } = mountLibraryRoute('/materials/41?project=3', rpc);
    const user = test.userEvent.setup();

    await test.screen.findByText(/Current extraction 41/);
    test.expect(rpc['materials.materialVersions']).not.toHaveBeenCalled();
    const summary = test.screen.getByText(catalogs.english.ReaderHistory);

    test.expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);
    await test.screen.findByRole('link', {
      name: new RegExp(`${catalogs.english.ReaderVersion} 2`)
    });
    await user.click(test.screen.getByRole('button', { name: catalogs.english.LibraryMore }));
    const historic = await test.screen.findByRole('link', {
      name: new RegExp(`${catalogs.english.ReaderVersion} 1`)
    });

    test.expect(historic).toHaveTextContent(catalogs.english.ReaderUnavailable);
    test.expect(rpc['materials.materialVersions']).toHaveBeenNthCalledWith(1, {
      materialId: materialId('41'),
      cursor: undefined,
      limit: 30
    });
    test.expect(rpc['materials.materialVersions']).toHaveBeenNthCalledWith(2, {
      materialId: materialId('41'),
      cursor: undefined,
      limit: 60
    });
    await user.click(historic);
    test
      .expect(await test.within(await test.screen.findByRole('main')).findByRole('alert'))
      .toHaveTextContent(catalogs.english.ReaderUnavailable);
    test.expect(router.state.location.search).toMatchObject({ project: '3', version: '101' });
    test.expect(test.screen.queryByText(/Current extraction 41/)).toBeNull();
    test.expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
  }
);

test.stable(
  'preserves the collection while moving from historical to current content',
  async () => {
    const { router } = mountLibraryRoute('/materials/41?project=3&version=101');

    await test.screen.findByText(/Historical extraction/);
    await test.userEvent
      .setup()
      .click(test.screen.getByRole('link', { name: catalogs.english.ReaderCurrent }));
    await test.screen.findByText(/Current extraction 41/);
    test.expect(router.state.location.search).toMatchObject({ project: '3', version: '102' });
  }
);

test.stable(
  'opens deletion through reader Actions and recovers accepted cleanup after the reader becomes fenced',
  async () => {
    const preview = Schema.decodeUnknownSync(materialDeletionPreviewSchema)({
      materialId: 41n,
      token: 'delete-preview',
      descendants: [],
      materials: [{ materialId: 41n, versionIds: [102n], unavailable: false }],
      missingEvidence: 'exact_deleted_input_versions',
      versionIds: [102n],
      references: [],
      sourceIds: [],
      sharedImageSourceIds: [],
      noteIds: [],
      retainedMessageCitationCount: 0,
      privateRequestIds: [],
      retainedCopies: 'unselected_materials_and_published_messages_including_recordings'
    });
    const operation = Schema.decodeUnknownSync(materialDeletionSchema)({
      materialId: 41n,
      operationId: 'delete-41',
      materialIds: [41n],
      status: 'pending',
      phase: 'retired',
      attempt: 1,
      errorKind: null,
      completedAt: null
    });
    const rpc = {
      ...materialRpc(),
      'materials.previewDeletion': test.vi
        .fn<StudyClient['materials.previewDeletion']>()
        .mockReturnValue(Effect.succeed(preview)),
      'materials.requestDeletion': test.vi
        .fn<StudyClient['materials.requestDeletion']>()
        .mockReturnValue(Effect.succeed(operation))
    };

    rpc['materials.deletion'].mockReturnValue(Effect.succeed(operation));
    mountLibraryRoute('/materials/41', rpc);
    const user = test.userEvent.setup();

    await test.screen.findByText(/Current extraction 41/);
    const actions = test.screen.getByText(catalogs.english.ReaderActions, { selector: 'summary' });

    test.expect(actions.closest('details')).not.toHaveAttribute('open');
    await user.click(actions);
    test.expect(actions.closest('details')).toHaveAttribute('open');
    await user.click(test.screen.getByRole('button', { name: catalogs.english.PageDelete }));
    const dialog = test.within(
      await test.screen.findByRole('dialog', { name: catalogs.english.PageDelete })
    );

    test.expect(rpc['materials.requestDeletion']).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: catalogs.english.PagePreview }));
    await dialog.findByRole('button', { name: catalogs.english.PageConfirmDelete });
    test.expect(rpc['materials.previewDeletion']).toHaveBeenCalledExactlyOnceWith({
      materialId: materialId('41')
    });
    test.expect(rpc['materials.requestDeletion']).not.toHaveBeenCalled();
    // Accepted deletion retires content before the next live reader snapshot.
    rpc['materials.material'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Retired')));
    await user.click(dialog.getByRole('button', { name: catalogs.english.PageConfirmDelete }));
    const confirmation = test.within(await test.screen.findByRole('alertdialog'));

    await user.type(confirmation.getByRole('textbox'), catalogs.english.DeleteConfirmationWord);
    await user.click(
      confirmation.getByRole('button', { name: catalogs.english.PageConfirmDelete })
    );
    const recovery = test.within(
      await test.screen.findByRole('region', { name: catalogs.english.PageDelete })
    );

    await recovery.findByText(catalogs.english.PageCleanupPending);
    test.expect(test.screen.queryByText(/Current extraction 41/)).toBeNull();
    test.expect(rpc['materials.requestDeletion']).toHaveBeenCalledExactlyOnceWith({
      materialId: materialId('41'),
      token: 'delete-preview'
    });
    rpc['materials.deletion'].mockReturnValue(
      Effect.succeed({ ...operation, status: 'completed', phase: 'completed', completedAt: 2n })
    );
    await user.click(recovery.getByRole('button', { name: catalogs.english.LibraryRefresh }));
    await recovery.findByText(catalogs.english.PageCleanupCompleted);
    test.expect(rpc['materials.requestDeletion']).toHaveBeenCalledTimes(1);
    test.expect(rpc['materials.retryDeletion']).not.toHaveBeenCalled();
  }
);

test.stable('reports CSV structure loss without an unrelated image warning', async () => {
  const rpc = materialRpc();

  rpc['settings.workspacePreferences'].mockReturnValue(
    Effect.succeed({ ...defaultWorkspacePreferences, defaultExportFormat: 'csv' })
  );
  rpc['materials.materialVersion'].mockReturnValue(
    Effect.succeed(
      Schema.decodeUnknownSync(materialVersionDetailSchema)({
        ...learningVersion(),
        kind: 'flashcards',
        content: { kind: 'flashcards', cards: [] }
      })
    )
  );
  rpc['materials.exportMaterialVersion'].mockReturnValue(
    Effect.succeed({
      versionId: versionId('101'),
      format: 'csv',
      filename: 'cards.csv',
      mediaType: 'text/csv; charset=utf-8',
      bytes: new Uint8Array(new TextEncoder().encode('cardId,front,back')),
      omissions: [{ code: 'csv_structure' }]
    })
  );
  const download = test.vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const create = test.vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv-export');

  try {
    mountLibraryRoute('/materials/41?version=101', rpc);
    const button = await test.screen.findByRole('button', {
      name: catalogs.english.ExportDownload
    });

    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('combobox', { name: catalogs.english.ExportFormat }))
        .toHaveTextContent(catalogs.english.ExportCsv)
    );
    await test.userEvent.click(button);
    test.expect(await test.screen.findByText(catalogs.english.ExportOmitCsv)).toBeInTheDocument();
    test.expect(test.screen.queryByText(catalogs.english.ExportOmitImage)).not.toBeInTheDocument();
    test.expect(rpc['materials.exportMaterialVersion']).toHaveBeenCalledWith({
      id: versionId('101'),
      format: 'csv'
    });
  } finally {
    download.mockRestore();
    create.mockRestore();
  }
});

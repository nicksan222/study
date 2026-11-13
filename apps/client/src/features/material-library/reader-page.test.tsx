import { StudyError } from '@study/contracts/errors';
import {
  materialDeletionPreviewSchema,
  materialDeletionSchema
} from '@study/contracts/materials/deletion';
import {
  materialVersionDetailSchema,
  materialVersionSummarySchema
} from '@study/contracts/materials/schemas';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import type { StudyClient } from '#client/lib/study-client/client.ts';

import { materialId, versionId } from './identity';
import { learningVersion, materialRpc, mountLibraryRoute } from './test/support';

vi.mock('#client/lib/study-client/request.ts', () => ({ request: vi.fn() }));

testStable(
  'rejects a foreign Material version before rendering extraction or exposing its original',
  async () => {
    const rpc = materialRpc();

    rpc['materials.materialVersion'].mockReturnValue(Effect.succeed(learningVersion(101n, 99n)));
    mountLibraryRoute('/materials/41?version=101', rpc);
    expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
      catalogs.english.ReaderUnavailable
    );
    expect(screen.queryByText(/Historical extraction/)).toBeNull();
    expect(screen.queryByText(/Current extraction 41/)).toBeNull();
    expect(screen.queryByRole('button', { name: catalogs.english.ReaderOriginal })).toBeNull();
    expect(rpc['materials.materialVersion']).toHaveBeenCalledExactlyOnceWith({
      id: versionId('101')
    });
    expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
  }
);

testStable(
  'loads history only on opening, paginates by version cursor and preserves collection on selection',
  async () => {
    const rpc = materialRpc();
    const decode = Schema.decodeUnknownSync(materialVersionSummarySchema);
    const current = decode(learningVersion(102n));
    const old = decode({ ...learningVersion(), availability: 'unavailable' });

    rpc['materials.materialVersions']
      .mockReturnValueOnce(Effect.succeed({ items: [current], nextCursor: versionId('102') }))
      .mockReturnValueOnce(Effect.succeed({ items: [old], nextCursor: null }));
    rpc['materials.materialVersion'].mockImplementation(({ id }) =>
      id === versionId('101')
        ? Effect.fail(new StudyError('not_found', 'Historical version unavailable'))
        : Effect.succeed(learningVersion(102n, 41n, 'Current extraction 41'))
    );
    const { router } = mountLibraryRoute('/materials/41?project=3', rpc);
    const user = userEvent.setup();

    await screen.findByText(/Current extraction 41/);
    expect(rpc['materials.materialVersions']).not.toHaveBeenCalled();
    const summary = screen.getByText(catalogs.english.ReaderHistory);

    expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);
    await screen.findByRole('link', { name: new RegExp(`${catalogs.english.ReaderVersion} 2`) });
    await user.click(screen.getByRole('button', { name: catalogs.english.LibraryMore }));
    const historic = await screen.findByRole('link', {
      name: new RegExp(`${catalogs.english.ReaderVersion} 1`)
    });

    expect(historic).toHaveTextContent(catalogs.english.ReaderUnavailable);
    expect(rpc['materials.materialVersions']).toHaveBeenNthCalledWith(1, {
      materialId: materialId('41'),
      cursor: undefined,
      limit: 30
    });
    expect(rpc['materials.materialVersions']).toHaveBeenNthCalledWith(2, {
      materialId: materialId('41'),
      cursor: versionId('102'),
      limit: 30
    });
    await user.click(historic);
    expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
      catalogs.english.ReaderUnavailable
    );
    expect(router.state.location.search).toMatchObject({ project: '3', version: '101' });
    expect(screen.queryByText(/Current extraction 41/)).toBeNull();
    expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
  }
);

testStable('preserves the collection while moving from historical to current content', async () => {
  const { router } = mountLibraryRoute('/materials/41?project=3&version=101');

  await screen.findByText(/Historical extraction/);
  await userEvent.setup().click(screen.getByRole('link', { name: catalogs.english.ReaderCurrent }));
  await screen.findByText(/Current extraction 41/);
  expect(router.state.location.search).toMatchObject({ project: '3', version: '102' });
});

testStable(
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
      'materials.previewDeletion': vi
        .fn<StudyClient['materials.previewDeletion']>()
        .mockReturnValue(Effect.succeed(preview)),
      'materials.requestDeletion': vi
        .fn<StudyClient['materials.requestDeletion']>()
        .mockReturnValue(Effect.succeed(operation))
    };

    rpc['materials.deletion'].mockReturnValue(Effect.succeed(operation));
    mountLibraryRoute('/materials/41', rpc);
    const user = userEvent.setup();

    await screen.findByText(/Current extraction 41/);
    const actions = screen.getByText(catalogs.english.ReaderActions, { selector: 'summary' });

    expect(actions.closest('details')).not.toHaveAttribute('open');
    await user.click(actions);
    expect(actions.closest('details')).toHaveAttribute('open');
    await user.click(screen.getByRole('button', { name: catalogs.english.PageDelete }));
    const dialog = within(await screen.findByRole('dialog', { name: catalogs.english.PageDelete }));

    expect(rpc['materials.requestDeletion']).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: catalogs.english.PagePreview }));
    await dialog.findByRole('button', { name: catalogs.english.PageConfirmDelete });
    expect(rpc['materials.previewDeletion']).toHaveBeenCalledExactlyOnceWith({
      materialId: materialId('41')
    });
    expect(rpc['materials.requestDeletion']).not.toHaveBeenCalled();
    // Accepted deletion retires content before invalidation refetches the reader.
    rpc['materials.material'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Retired')));
    await user.click(dialog.getByRole('button', { name: catalogs.english.PageConfirmDelete }));
    const confirmation = within(await screen.findByRole('alertdialog'));

    await user.type(confirmation.getByRole('textbox'), catalogs.english.DeleteConfirmationWord);
    await user.click(
      confirmation.getByRole('button', { name: catalogs.english.PageConfirmDelete })
    );
    const recovery = within(
      await screen.findByRole('region', { name: catalogs.english.PageDelete })
    );

    await recovery.findByText(catalogs.english.PageCleanupPending);
    expect(screen.queryByText(/Current extraction 41/)).toBeNull();
    expect(rpc['materials.requestDeletion']).toHaveBeenCalledExactlyOnceWith({
      materialId: materialId('41'),
      token: 'delete-preview'
    });
    rpc['materials.deletion'].mockReturnValue(
      Effect.succeed({ ...operation, status: 'completed', phase: 'completed', completedAt: 2n })
    );
    await user.click(recovery.getByRole('button', { name: catalogs.english.LibraryRefresh }));
    await recovery.findByText(catalogs.english.PageCleanupCompleted);
    expect(rpc['materials.requestDeletion']).toHaveBeenCalledTimes(1);
    expect(rpc['materials.retryDeletion']).not.toHaveBeenCalled();
  }
);

testStable('reports CSV structure loss without an unrelated image warning', async () => {
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
      bytes: new TextEncoder().encode('cardId,front,back'),
      omissions: [{ code: 'csv_structure' }]
    })
  );
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv-export');

  try {
    mountLibraryRoute('/materials/41?version=101', rpc);
    const button = await screen.findByRole('button', { name: catalogs.english.ExportDownload });

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: catalogs.english.ExportFormat })
      ).toHaveTextContent(catalogs.english.ExportCsv)
    );
    await userEvent.click(button);
    expect(await screen.findByText(catalogs.english.ExportOmitCsv)).toBeInTheDocument();
    expect(screen.queryByText(catalogs.english.ExportOmitImage)).not.toBeInTheDocument();
    expect(rpc['materials.exportMaterialVersion']).toHaveBeenCalledWith({
      id: versionId('101'),
      format: 'csv'
    });
  } finally {
    download.mockRestore();
    create.mockRestore();
  }
});

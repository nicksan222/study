import { StudyError } from '@study/contracts/errors';
import {
  materialDeletionPreviewSchema,
  materialDeletionSchema
} from '@study/contracts/materials/deletion';
import { materialVersionSummarySchema } from '@study/contracts/materials/schemas';
import { catalogs } from '@study/localization';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, it, vi } from 'vite-plus/test';

import type { StudyClient } from '../../lib/study-client/client';
import { materialId, versionId } from './identity';
import { importedSource, importedVersion, materialRpc, mountLibraryRoute } from './test/support';

vi.mock('../../lib/study-client/request', () => ({ request: vi.fn() }));

it('rejects a foreign Material version before rendering extraction or exposing its original', async () => {
  const rpc = materialRpc();

  rpc['materials.materialVersion'].mockReturnValue(Effect.succeed(importedVersion(101n, 99n)));
  mountLibraryRoute('/materials/41?version=101', rpc);
  expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
    catalogs.english.ReaderUnavailable
  );
  expect(screen.queryByText('Historical extraction')).toBeNull();
  expect(screen.queryByText('Current extraction 41')).toBeNull();
  expect(screen.queryByRole('button', { name: catalogs.english.ReaderOriginal })).toBeNull();
  expect(rpc['materials.materialVersion']).toHaveBeenCalledExactlyOnceWith({
    id: versionId('101')
  });
  expect(rpc['materials.materialVersionDocument']).not.toHaveBeenCalled();
  expect(rpc['materials.materialVersionImage']).not.toHaveBeenCalled();
  expect(rpc['materials.materialVersionExport']).not.toHaveBeenCalled();
  expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
});

it('keeps unavailable historical extraction unavailable without falling back to current content or bytes', async () => {
  const rpc = materialRpc();

  rpc['materials.materialVersion'].mockReturnValue(
    Effect.fail(new StudyError('not_found', 'Revision unavailable'))
  );
  mountLibraryRoute('/materials/41?version=101', rpc);
  expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
    catalogs.english.ReaderUnavailable
  );
  expect(screen.queryByText('Current extraction 41')).toBeNull();
  expect(screen.queryByRole('button', { name: catalogs.english.ReaderOriginal })).toBeNull();
  expect(rpc['materials.materialVersion']).toHaveBeenCalledExactlyOnceWith({
    id: versionId('101')
  });
  expect(rpc['materials.materialVersionDocument']).not.toHaveBeenCalled();
  expect(rpc['materials.materialVersionImage']).not.toHaveBeenCalled();
  expect(rpc['materials.materialVersionExport']).not.toHaveBeenCalled();
  expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
});

it('exports the selected historical version with its exact retained bytes, MIME and filename', async () => {
  const rpc = materialRpc();
  const bytes = new Uint8Array([0, 128, 255]);

  rpc['materials.materialVersionExport'].mockReturnValue(
    Effect.succeed({ source: importedSource, bytes })
  );
  const createObjectURL = vi
    .fn<(blob: Blob) => string>()
    .mockReturnValue('blob:historical-original');
  const revokeObjectURL = vi.fn();

  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
  );
  let delivery: { href: string; filename: string } | undefined;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    delivery = { href: this.href, filename: this.download };
  });

  try {
    mountLibraryRoute('/materials/41?version=101', rpc);
    await screen.findByText('Historical extraction');
    expect(screen.queryByText('Current extraction 41')).toBeNull();
    const original = screen.getByRole('button', { name: catalogs.english.ReaderOriginal });

    await userEvent.setup().click(original);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0]![0];

    expect(blob.type).toBe(importedSource.mime);
    const retained = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });

    expect(new Uint8Array(retained)).toEqual(bytes);
    expect(delivery).toEqual({ href: 'blob:historical-original', filename: importedSource.name });
    expect(rpc['materials.materialVersionExport']).toHaveBeenCalledExactlyOnceWith({
      id: versionId('101')
    });
    expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
    await waitFor(() => expect(original).toBeEnabled(), { timeout: 2500 });
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:historical-original');
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('reports an unavailable historical original without requesting a current-version or Source fallback', async () => {
  const rpc = materialRpc();

  rpc['materials.materialVersionExport'].mockReturnValue(
    Effect.fail(new StudyError('not_found', 'Original unavailable'))
  );
  mountLibraryRoute('/materials/41?version=101', rpc);
  const original = await screen.findByRole('button', { name: catalogs.english.ReaderOriginal });

  await userEvent.setup().click(original);
  expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
    catalogs.english.ReaderOriginalUnavailable
  );
  expect(rpc['materials.materialVersionExport']).toHaveBeenCalledExactlyOnceWith({
    id: versionId('101')
  });
  expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
  expect(screen.getByText('Historical extraction')).toBeInTheDocument();
});

it('loads history only on opening, paginates by version cursor and preserves collection on selection', async () => {
  const rpc = materialRpc();
  const decode = Schema.decodeUnknownSync(materialVersionSummarySchema);
  const current = decode(importedVersion(102n));
  const old = decode({ ...importedVersion(), availability: 'unavailable' });

  rpc['materials.materialVersions']
    .mockReturnValueOnce(Effect.succeed({ items: [current], nextCursor: versionId('102') }))
    .mockReturnValueOnce(Effect.succeed({ items: [old], nextCursor: null }));
  rpc['materials.materialVersion'].mockImplementation(({ id }) =>
    id === versionId('101')
      ? Effect.fail(new StudyError('not_found', 'Historical version unavailable'))
      : Effect.succeed(importedVersion(102n, 41n, 'Current extraction 41'))
  );
  const { router } = mountLibraryRoute('/materials/41?project=3', rpc);
  const user = userEvent.setup();

  await screen.findByText('Current extraction 41');
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
  expect(screen.queryByText('Current extraction 41')).toBeNull();
  expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
});

it('preserves the collection while moving from historical to current content', async () => {
  const { router } = mountLibraryRoute('/materials/41?project=3&version=101');

  await screen.findByText('Historical extraction');
  await userEvent.setup().click(screen.getByRole('link', { name: catalogs.english.ReaderCurrent }));
  await screen.findByText('Current extraction 41');
  expect(router.state.location.search).toMatchObject({ project: '3', version: '102' });
});

it('opens deletion through reader Actions and recovers accepted cleanup after the reader becomes fenced', async () => {
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
    sessionIds: [],
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

  await screen.findByText('Current extraction 41');
  const actions = screen.getByText(catalogs.english.ReaderActions, { selector: 'summary' });

  expect(actions.closest('details')).not.toHaveAttribute('open');
  await user.click(actions);
  expect(actions.closest('details')).toHaveAttribute('open');
  await user.click(screen.getByRole('button', { name: catalogs.english.DocumentDelete }));
  const dialog = within(
    await screen.findByRole('dialog', { name: catalogs.english.DocumentDelete })
  );

  expect(rpc['materials.requestDeletion']).not.toHaveBeenCalled();
  await user.click(dialog.getByRole('button', { name: catalogs.english.DocumentPreview }));
  await dialog.findByRole('button', { name: catalogs.english.DocumentConfirmDelete });
  expect(rpc['materials.previewDeletion']).toHaveBeenCalledExactlyOnceWith({
    materialId: materialId('41')
  });
  expect(rpc['materials.requestDeletion']).not.toHaveBeenCalled();
  // Accepted deletion retires content before invalidation refetches the reader.
  rpc['materials.material'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Retired')));
  await user.click(dialog.getByRole('button', { name: catalogs.english.DocumentConfirmDelete }));
  const recovery = within(
    await screen.findByRole('region', { name: catalogs.english.DocumentDelete })
  );

  await recovery.findByText(catalogs.english.DocumentCleanupPending);
  expect(screen.queryByText('Current extraction 41')).toBeNull();
  expect(rpc['materials.requestDeletion']).toHaveBeenCalledExactlyOnceWith({
    materialId: materialId('41'),
    token: 'delete-preview',
    descendantIds: []
  });
  rpc['materials.deletion'].mockReturnValue(
    Effect.succeed({ ...operation, status: 'completed', phase: 'completed', completedAt: 2n })
  );
  await user.click(recovery.getByRole('button', { name: catalogs.english.LibraryRefresh }));
  await recovery.findByText(catalogs.english.DocumentCleanupCompleted);
  expect(rpc['materials.requestDeletion']).toHaveBeenCalledTimes(1);
  expect(rpc['materials.retryDeletion']).not.toHaveBeenCalled();
});

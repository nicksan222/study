import { StudyError } from '@study/contracts/errors';
import { materialDeletionSchema } from '@study/contracts/materials/deletion';
import { historyPreviewSchema, historyPruneSchema } from '@study/contracts/materials/history';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import type * as ToastModule from '@study/ui/toast';
import { toastManager } from '@study/ui/toast';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { runRequest } from '#web/lib/effect/runtime.ts';
import { createStudyQueryClient } from '#web/lib/query-client.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { materialId, versionId } from './identity';
import { MaterialLifecycle } from './material-lifecycle';
import { materialRpc, mountLibraryRoute } from './test/support';

vi.mock('@study/ui/toast', async (load) => {
  const actual = await load<typeof ToastModule>();

  return { ...actual, toastManager: { ...actual.toastManager, add: vi.fn() } };
});
beforeEach(() => vi.mocked(toastManager.add).mockClear());

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

function prunePreview() {
  return Schema.decodeUnknownSync(historyPreviewSchema)({
    materialId: 41n,
    policy: { keepLatest: 10 },
    token: 'a'.repeat(64),
    candidateIds: [101n],
    hasMore: true,
    protected: [],
    references: [],
    privateRequestIds: [],
    retainedMessageCitationCount: 0,
    sourceRevisions: [],
    removedBodyBytes: 0n,
    byteSemantics: 'learning_body_columns',
    missingEvidence: 'exact_pruned_versions',
    retainedCopies: 'other_versions_and_published_messages'
  });
}

testStable(
  'recovers failed durable deletion on a fresh reader whose content is already fenced',
  async () => {
    const rpc = materialRpc();
    const operation = Schema.decodeUnknownSync(materialDeletionSchema)({
      materialId: 41n,
      operationId: 'delete-41',
      materialIds: [41n],
      status: 'failed',
      phase: 'retired',
      attempt: 1,
      errorKind: 'transient',
      completedAt: null
    });

    rpc['materials.material'].mockReturnValue(Effect.fail(new StudyError('not_found', 'Retired')));
    rpc['materials.deletion'].mockReturnValue(Effect.succeed(operation));
    rpc['materials.retryDeletion'].mockReturnValue(
      Effect.succeed({ ...operation, status: 'pending', attempt: 2, errorKind: null })
    );
    mountLibraryRoute('/materials/41', rpc);
    const user = userEvent.setup();
    const recovery = await screen.findByRole('region', { name: catalogs.english.DocumentDelete });

    await within(recovery).findByText(catalogs.english.DocumentCleanupFailed);
    await user.click(
      within(recovery).getByRole('button', { name: catalogs.english.DocumentRetryCleanup })
    );
    await within(recovery).findByText(catalogs.english.DocumentCleanupPending);
    expect(rpc['materials.retryDeletion']).toHaveBeenCalledExactlyOnceWith({
      materialId: materialId('41')
    });
    expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    rpc['materials.deletion'].mockReturnValue(
      Effect.succeed({ ...operation, status: 'completed', phase: 'completed', completedAt: 2n })
    );
    await user.click(
      within(recovery).getByRole('button', { name: catalogs.english.LibraryRefresh })
    );
    await within(recovery).findByText(catalogs.english.DocumentCleanupCompleted);
  }
);

testStable(
  'replays a lost prune acceptance after remount, retains its receipt, and starts a fresh next batch',
  async () => {
    const preview = prunePreview();
    const rpc = {
      'materials.previewHistoryPrune': vi
        .fn<StudyClient['materials.previewHistoryPrune']>()
        .mockReturnValue(Effect.succeed(preview)),
      'materials.requestHistoryPrune': vi
        .fn<StudyClient['materials.requestHistoryPrune']>()
        .mockReturnValueOnce(Effect.fail(new StudyError('internal', 'Response lost')))
    };

    // Subsequent requests emulate the durable server receipt, including replay of the same input.
    rpc['materials.requestHistoryPrune'].mockImplementation(
      ({ operationId, materialId, policy, candidateIds }) =>
        Effect.succeed(
          Schema.decodeUnknownSync(historyPruneSchema)({
            operationId,
            materialId,
            policy,
            candidateIds,
            status: 'completed',
            attempt: 1,
            errorKind: null,
            completedAt: 2n
          })
        )
    );
    vi.mocked(request).mockImplementation((invoke, signal) =>
      runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
    );
    const client = createStudyQueryClient();
    const mount = () =>
      render(
        <QueryClientProvider client={client}>
          <MaterialLifecycle id={materialId('41')} />
        </QueryClientProvider>
      );
    let view = mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentPrune }));
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentPreview }));
    {
      await user.click(
        await screen.findByRole('button', { name: catalogs.english.DocumentConfirmPrune })
      );
      const confirmation = await screen.findByRole('alertdialog');
      const confirm = within(confirmation).getByRole('button', {
        name: catalogs.english.DocumentConfirmPrune
      });

      expect(confirm).toBeDisabled();
      await user.type(
        within(confirmation).getByRole('textbox'),
        catalogs.english.DeleteConfirmationWord
      );
      await user.click(confirm);
    }
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: catalogs.english.DocumentPruneNext })).toBeNull();
    const first = rpc['materials.requestHistoryPrune'].mock.calls[0]![0];

    view.unmount();
    view = mount();
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentPrune }));
    expect(screen.queryByRole('button', { name: catalogs.english.DocumentPreview })).toBeNull();
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentRetryCleanup }));
    await screen.findByText(catalogs.english.DocumentCleanupCompleted);
    expect(rpc['materials.requestHistoryPrune'].mock.calls[1]![0]).toEqual(first);
    view.unmount();
    mount();
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentPrune }));
    await screen.findByText(catalogs.english.DocumentCleanupCompleted);
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentPruneNext }));
    expect(screen.queryByText(catalogs.english.DocumentCleanupCompleted)).toBeNull();
    expect(
      screen.queryByRole('button', { name: catalogs.english.DocumentConfirmPrune })
    ).toBeNull();
    rpc['materials.previewHistoryPrune'].mockReturnValue(
      Effect.succeed({
        ...preview,
        token: 'b'.repeat(64),
        candidateIds: [versionId('100')],
        hasMore: false
      })
    );
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentPreview }));
    {
      await user.click(
        await screen.findByRole('button', { name: catalogs.english.DocumentConfirmPrune })
      );
      const confirmation = await screen.findByRole('alertdialog');
      const confirm = within(confirmation).getByRole('button', {
        name: catalogs.english.DocumentConfirmPrune
      });

      expect(confirm).toBeDisabled();
      await user.type(
        within(confirmation).getByRole('textbox'),
        catalogs.english.DeleteConfirmationWord
      );
      await user.click(confirm);
    }
    await screen.findByText(catalogs.english.DocumentCleanupCompleted);
    const next = rpc['materials.requestHistoryPrune'].mock.calls[2]![0];

    expect(next.operationId).not.toBe(first.operationId);
    expect(next.token).toBe('b'.repeat(64));
    expect(next.candidateIds).toEqual([versionId('100')]);
    await act(async () => {
      client.clear();
    });
  }
);

testStable(
  'keeps a failed prune receipt in review and never announces it as queued or successful',
  async () => {
    const preview = prunePreview();
    const failed = Schema.decodeUnknownSync(historyPruneSchema)({
      operationId: 'failed-prune',
      materialId: preview.materialId,
      policy: preview.policy,
      candidateIds: preview.candidateIds,
      status: 'failed',
      attempt: 1,
      errorKind: 'transient',
      completedAt: null
    });
    const rpc = {
      'materials.previewHistoryPrune': vi
        .fn<StudyClient['materials.previewHistoryPrune']>()
        .mockReturnValue(Effect.succeed(preview)),
      'materials.requestHistoryPrune': vi
        .fn<StudyClient['materials.requestHistoryPrune']>()
        .mockReturnValue(Effect.succeed(failed))
    };

    vi.mocked(request).mockImplementation((invoke, signal) =>
      runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
    );
    const client = createStudyQueryClient();

    render(
      <QueryClientProvider client={client}>
        <MaterialLifecycle id={materialId('41')} />
      </QueryClientProvider>
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentPrune }));
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentPreview }));
    await user.click(
      await screen.findByRole('button', { name: catalogs.english.DocumentConfirmPrune })
    );
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', {
      name: catalogs.english.DocumentConfirmPrune
    });

    expect(confirm).toBeDisabled();
    expect(rpc['materials.requestHistoryPrune']).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox'), catalogs.english.DeleteConfirmationWord);
    await user.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      catalogs.english.DocumentCleanupFailed
    );
    expect(confirm).toBeDisabled();
    expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
      title: catalogs.english.DocumentCleanupFailed,
      type: 'error'
    });
    const submitted = rpc['materials.requestHistoryPrune'].mock.calls[0]![0];

    expect(submitted.materialId).toBe(preview.materialId);
    expect(submitted.token).toBe(preview.token);
    expect(submitted.candidateIds).toEqual(preview.candidateIds);
    expect(submitted.operationId).toBeTruthy();
    client.clear();
  }
);

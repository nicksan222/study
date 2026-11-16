import {
  StudyError,
  materialDeletionSchema,
  historyPreviewSchema,
  historyPruneSchema
} from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type * as ToastModule from '@study/ui';

let toastManager: typeof __MockType0.toastManager;

import type * as __MockType0 from '@study/ui';
import { Effect, Schema } from 'effect';

import type * as __MockType1 from './identity';
import type * as __MockType2 from './material-lifecycle';
import type * as __MockType3 from './test/support';

let materialId: typeof __MockType1.materialId;

let versionId: typeof __MockType1.versionId;

let MaterialLifecycle: typeof __MockType2.MaterialLifecycle;

let locationIs: typeof __MockType3.locationIs;

let materialRpc: typeof __MockType3.materialRpc;

let mountLibraryRoute: typeof __MockType3.mountLibraryRoute;

test.beforeEach(async ({ mock }) => {
  mock('@study/ui', async (load) => {
    const actual = await load<typeof ToastModule>();

    return { ...actual, toastManager: { ...actual.toastManager, add: mock.fn() } };
  });
  const __mockModule0 = await import('@study/ui');

  toastManager = __mockModule0.toastManager;
  const __mockModule1 = await import('./identity');

  materialId = __mockModule1.materialId;
  versionId = __mockModule1.versionId;
  const __mockModule2 = await import('./material-lifecycle');

  MaterialLifecycle = __mockModule2.MaterialLifecycle;
  const __mockModule3 = await import('./test/support');

  locationIs = __mockModule3.locationIs;
  materialRpc = __mockModule3.materialRpc;
  mountLibraryRoute = __mockModule3.mountLibraryRoute;
});

test.beforeEach(() => test.vi.mocked(toastManager.add).mockClear());

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

test.stable(
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
    rpc['materials.retryDeletion'].mockImplementation(() =>
      Effect.sync(() => {
        const pending = { ...operation, status: 'pending' as const, attempt: 2, errorKind: null };

        rpc['materials.deletion'].mockReturnValue(Effect.succeed(pending));

        return pending;
      })
    );
    const { router } = mountLibraryRoute('/materials/41', rpc);

    await locationIs(router, '/materials/41');
    const user = test.userEvent.setup();
    const recovery = await test.screen.findByRole('region', { name: catalogs.english.PageDelete });

    await test.within(recovery).findByText(catalogs.english.PageCleanupFailed);
    await user.click(
      test.within(recovery).getByRole('button', { name: catalogs.english.PageRetryCleanup })
    );
    await test.within(recovery).findByText(catalogs.english.PageCleanupPending);
    test.expect(rpc['materials.retryDeletion']).toHaveBeenCalledExactlyOnceWith({
      materialId: materialId('41')
    });
    test.expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    rpc['materials.deletion'].mockReturnValue(
      Effect.succeed({ ...operation, status: 'completed', phase: 'completed', completedAt: 2n })
    );
    await user.click(
      test.within(recovery).getByRole('button', { name: catalogs.english.LibraryRefresh })
    );
    await test.within(recovery).findByText(catalogs.english.PageCleanupCompleted);
  }
);

test.stable(
  'replays a lost prune acceptance after remount, retains its receipt, and starts a fresh next batch',
  async () => {
    const preview = prunePreview();
    const rpc = {
      'materials.previewHistoryPrune': test.vi
        .fn<StudyClient['materials.previewHistoryPrune']>()
        .mockReturnValue(Effect.succeed(preview)),
      'materials.requestHistoryPrune': test.vi
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

    const harness = test.rpcHandlersTransport(rpc);
    const mount = () =>
      test.render(
        <harness.wrapper>
          <MaterialLifecycle id={materialId('41')} />
        </harness.wrapper>
      );
    const view = mount();
    const user = test.userEvent.setup();

    await user.click(test.screen.getByRole('button', { name: catalogs.english.PagePrune }));
    await user.click(test.screen.getByRole('button', { name: catalogs.english.PagePreview }));
    {
      await user.click(
        await test.screen.findByRole('button', { name: catalogs.english.PageConfirmPrune })
      );
      const confirmation = await test.screen.findByRole('alertdialog');
      const confirm = test.within(confirmation).getByRole('button', {
        name: catalogs.english.PageConfirmPrune
      });

      test.expect(confirm).toBeDisabled();
      await user.type(
        test.within(confirmation).getByRole('textbox'),
        catalogs.english.DeleteConfirmationWord
      );
      await user.click(confirm);
    }
    await test.screen.findByRole('alert');
    test
      .expect(test.screen.queryByRole('button', { name: catalogs.english.PagePruneNext }))
      .toBeNull();
    const first = rpc['materials.requestHistoryPrune'].mock.calls[0]![0];

    view.rerender(<harness.wrapper>{null}</harness.wrapper>);
    view.rerender(
      <harness.wrapper>
        <MaterialLifecycle id={materialId('41')} />
      </harness.wrapper>
    );
    await user.click(test.screen.getByRole('button', { name: catalogs.english.PagePrune }));
    test
      .expect(test.screen.queryByRole('button', { name: catalogs.english.PagePreview }))
      .toBeNull();
    await user.click(test.screen.getByRole('button', { name: catalogs.english.PageRetryCleanup }));
    await test.screen.findByText(catalogs.english.PageCleanupCompleted);
    test.expect(rpc['materials.requestHistoryPrune'].mock.calls[1]![0]).toEqual(first);
    view.rerender(<harness.wrapper>{null}</harness.wrapper>);
    view.rerender(
      <harness.wrapper>
        <MaterialLifecycle id={materialId('41')} />
      </harness.wrapper>
    );
    await user.click(test.screen.getByRole('button', { name: catalogs.english.PagePrune }));
    await test.screen.findByText(catalogs.english.PageCleanupCompleted);
    await user.click(test.screen.getByRole('button', { name: catalogs.english.PagePruneNext }));
    test.expect(test.screen.queryByText(catalogs.english.PageCleanupCompleted)).toBeNull();
    test
      .expect(test.screen.queryByRole('button', { name: catalogs.english.PageConfirmPrune }))
      .toBeNull();
    rpc['materials.previewHistoryPrune'].mockReturnValue(
      Effect.succeed({
        ...preview,
        token: 'b'.repeat(64),
        candidateIds: [versionId('100')],
        hasMore: false
      })
    );
    await user.click(test.screen.getByRole('button', { name: catalogs.english.PagePreview }));
    {
      await user.click(
        await test.screen.findByRole('button', { name: catalogs.english.PageConfirmPrune })
      );
      const confirmation = await test.screen.findByRole('alertdialog');
      const confirm = test.within(confirmation).getByRole('button', {
        name: catalogs.english.PageConfirmPrune
      });

      test.expect(confirm).toBeDisabled();
      await user.type(
        test.within(confirmation).getByRole('textbox'),
        catalogs.english.DeleteConfirmationWord
      );
      await user.click(confirm);
    }
    await test.screen.findByText(catalogs.english.PageCleanupCompleted);
    const next = rpc['materials.requestHistoryPrune'].mock.calls[2]![0];

    test.expect(next.operationId).not.toBe(first.operationId);
    test.expect(next.token).toBe('b'.repeat(64));
    test.expect(next.candidateIds).toEqual([versionId('100')]);
    await test.act(async () => {});
  }
);

test.stable(
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
      'materials.previewHistoryPrune': test.vi
        .fn<StudyClient['materials.previewHistoryPrune']>()
        .mockReturnValue(Effect.succeed(preview)),
      'materials.requestHistoryPrune': test.vi
        .fn<StudyClient['materials.requestHistoryPrune']>()
        .mockReturnValue(Effect.succeed(failed))
    };

    const harness = test.rpcHandlersTransport(rpc);

    test.render(
      <harness.wrapper>
        <MaterialLifecycle id={materialId('41')} />
      </harness.wrapper>
    );
    const user = test.userEvent.setup();

    await user.click(test.screen.getByRole('button', { name: catalogs.english.PagePrune }));
    await user.click(test.screen.getByRole('button', { name: catalogs.english.PagePreview }));
    await user.click(
      await test.screen.findByRole('button', { name: catalogs.english.PageConfirmPrune })
    );
    const dialog = await test.screen.findByRole('alertdialog');
    const confirm = test.within(dialog).getByRole('button', {
      name: catalogs.english.PageConfirmPrune
    });

    test.expect(confirm).toBeDisabled();
    test.expect(rpc['materials.requestHistoryPrune']).not.toHaveBeenCalled();
    await user.type(
      test.within(dialog).getByRole('textbox'),
      catalogs.english.DeleteConfirmationWord
    );
    await user.click(confirm);
    test
      .expect(await test.within(dialog).findByRole('alert'))
      .toHaveTextContent(catalogs.english.PageCleanupFailed);
    test.expect(confirm).toBeDisabled();
    test.expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
      title: catalogs.english.PageCleanupFailed,
      type: 'error'
    });
    const submitted = rpc['materials.requestHistoryPrune'].mock.calls[0]![0];

    test.expect(submitted.materialId).toBe(preview.materialId);
    test.expect(submitted.token).toBe(preview.token);
    test.expect(submitted.candidateIds).toEqual(preview.candidateIds);
    test.expect(submitted.operationId).toBeTruthy();
  }
);

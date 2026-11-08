import { StudyError } from '@study/contracts/errors';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { authoredPage } from '../document-editing/test-support';
import {
  importedSource,
  locationIs,
  materialRpc,
  mountLibraryRoute
} from '../material-library/test/support';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const t = catalogs.english;

function historyFixture() {
  const rpc = materialRpc();
  const old = authoredPage(41n, 'Old source body', 1101n).version!;
  const current = authoredPage(41n, 'Current source body', 1201n).version!;
  const candidate = {
    sourceId: importedSource.id,
    revision: 1n,
    snapshotId: old.snapshotId,
    createdAt: 1n
  };
  const preview = {
    sourceId: importedSource.id,
    keepLatest: 1,
    name: importedSource.name,
    token: 'b'.repeat(64),
    candidates: [candidate],
    blockedSnapshotIds: [],
    semantics: 'retire_extractions_keep_original_revisions' as const
  };

  rpc['sources.previewHistory'].mockReturnValue(Effect.succeed(preview));
  rpc['sources.currentExtraction'].mockReturnValue(
    Effect.succeed({
      sourceId: importedSource.id,
      revision: 2n,
      snapshotId: current.snapshotId,
      name: importedSource.name,
      document: current.document
    })
  );
  rpc['sources.extraction'].mockReturnValue(
    Effect.succeed({ ...candidate, name: importedSource.name, document: old.document })
  );

  return { rpc, old, current, preview };
}

async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: t.SourceHistoryPrune }));
  const dialog = await screen.findByRole('alertdialog');
  const name = within(dialog).getByRole('textbox', { name: t.SourceDeleteName });

  await waitFor(() => expect(name).toBeEnabled());
  await user.type(name, importedSource.name);

  return dialog;
}

testStable(
  'removes only reviewed source bodies and returns historical reading to current without evicting authored copies',
  async () => {
    const { rpc, old, preview } = historyFixture();

    rpc['sources.retireHistory'].mockReturnValue(Effect.succeed(preview));
    const { queryClient } = mountLibraryRoute(
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );
    const independent = authoredPage(41n);

    queryClient.setQueryData(['pages', 'detail', '41'], independent);
    const user = userEvent.setup();

    expect(await screen.findByText('Old source body')).toBeVisible();
    const dialog = await review(user);

    expect(within(dialog).getByText(t.SourceHistoryHelp)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));
    expect(await screen.findByText(t.SourceHistoryRemoved)).toBeVisible();
    expect(await screen.findByText('Current source body')).toBeVisible();
    expect(rpc['sources.retireHistory']).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      keepLatest: 1,
      token: preview.token
    });
    expect(
      queryClient.getQueryData(['sources', 'extraction', '7', '1', String(old.snapshotId)])
    ).toBeUndefined();
    expect(queryClient.getQueryData(['pages', 'detail', '41'])).toBe(independent);
  }
);
testStable(
  'retains uncertain reviewed intent across remount and reconciles only when all reviewed identities are absent',
  async () => {
    const { rpc, preview } = historyFixture();

    rpc['sources.retireHistory'].mockReturnValue(
      Effect.fail(new StudyError('transient', 'Lost response'))
    );
    const { router } = mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    const user = userEvent.setup();
    const dialog = await review(user);

    await user.click(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));
    expect(await within(dialog).findByText(t.SourceHistoryFailed)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: t.Cancel }));
    await act(() => router.navigate({ to: '/notes' }));
    await locationIs(router, '/notes');
    await act(() => router.navigate({ to: '/sources/$sourceId', params: { sourceId: '7' } }));
    await locationIs(router, '/sources/7');
    await user.click(await screen.findByRole('button', { name: t.SourceHistoryPrune }));
    const reopened = await screen.findByRole('alertdialog');

    expect(within(reopened).getByRole('button', { name: t.SourceHistoryConfirm })).toBeDisabled();
    await user.click(within(reopened).getByRole('button', { name: t.SourceHistoryRecover }));
    expect(await within(reopened).findByText(t.SourceHistoryFailed)).toBeVisible();
    expect(within(reopened).getByRole('button', { name: t.SourceHistoryConfirm })).toBeDisabled();
    rpc['sources.previewHistory'].mockReturnValue(
      Effect.succeed({ ...preview, candidates: [], token: 'c'.repeat(64) })
    );
    await user.click(within(reopened).getByRole('button', { name: t.SourceHistoryRecover }));
    expect(await screen.findByText(t.SourceHistoryReconciled)).toBeVisible();
    expect(rpc['sources.retireHistory']).toHaveBeenCalledTimes(1);
  }
);
testStable('shows exact evidence blockers and cannot authorize their removal', async () => {
  const { rpc, old, preview } = historyFixture();

  rpc['sources.previewHistory'].mockReturnValue(
    Effect.succeed({ ...preview, blockedSnapshotIds: [old.snapshotId] })
  );
  mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: t.SourceHistoryPrune }));
  const dialog = await screen.findByRole('alertdialog');

  expect(await within(dialog).findByText(t.SourceHistoryPinned)).toBeVisible();
  expect(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: t.Cancel }));
  expect(screen.getByText('Old source body')).toBeVisible();
  expect(rpc['sources.retireHistory']).not.toHaveBeenCalled();
});

testStable.each([false, true])(
  'reconciles a retired cached current extraction after pruning (uncertain: %s)',
  async (uncertain) => {
    const { rpc, old, preview } = historyFixture();

    if (uncertain)
      rpc['sources.retireHistory'].mockReturnValue(
        Effect.fail(new StudyError('transient', 'Lost response'))
      );
    else rpc['sources.retireHistory'].mockReturnValue(Effect.succeed(preview));

    const { queryClient, router } = mountLibraryRoute(
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );
    const key = ['sources', 'current-extraction', '7'];

    queryClient.setQueryData(key, {
      ...preview.candidates[0],
      name: importedSource.name,
      document: old.document
    });
    await screen.findByText('Old source body');
    const user = userEvent.setup();
    const dialog = await review(user);

    await user.click(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));

    if (uncertain) {
      await within(dialog).findByText(t.SourceHistoryFailed);
      await waitFor(() => expect(queryClient.getQueryData(key)).toBeUndefined());
      await user.click(within(dialog).getByRole('button', { name: t.Cancel }));
    } else {
      await screen.findByText(t.SourceHistoryRemoved);
      expect(await screen.findByText('Current source body')).toBeVisible();
      expect(screen.queryByText('Old source body')).toBeNull();
    }

    await act(() => router.navigate({ to: '/notes' }));
    await locationIs(router, '/notes');
    await act(() => router.navigate({ to: '/sources/$sourceId', params: { sourceId: '7' } }));
    expect(await screen.findByText('Current source body')).toBeVisible();
    expect(screen.queryByText('Old source body')).toBeNull();
  }
);

testStable(
  'preserves a fresh retained current snapshot and unrelated source cache when pruning older history',
  async () => {
    const { rpc, current, preview } = historyFixture();

    rpc['sources.retireHistory'].mockReturnValue(Effect.succeed(preview));
    const { queryClient } = mountLibraryRoute(
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );
    const retained = {
      sourceId: importedSource.id,
      revision: 2n,
      snapshotId: current.snapshotId,
      name: importedSource.name,
      document: current.document
    };
    const key = ['sources', 'current-extraction', '7'];

    queryClient.setQueryData(key, retained);
    queryClient.setQueryData(['sources', 'current-extraction', '8'], {
      ...retained,
      snapshotId: preview.candidates[0]!.snapshotId
    });
    const user = userEvent.setup();
    const dialog = await review(user);

    await user.click(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));
    await screen.findByText(t.SourceHistoryRemoved);
    expect(await screen.findByText('Current source body')).toBeVisible();
    expect(queryClient.getQueryData(key)).toBe(retained);
    expect(queryClient.getQueryData(['sources', 'current-extraction', '8'])).toBeDefined();
    expect(rpc['sources.currentExtraction']).not.toHaveBeenCalled();
  }
);

testStable.each([false, true])(
  'resets a mounted retired current cache and retains the reconciled current B (uncertain: %s)',
  async (uncertain) => {
    const { rpc, old, current, preview } = historyFixture();

    if (uncertain)
      rpc['sources.retireHistory'].mockReturnValue(
        Effect.fail(new StudyError('transient', 'Lost response'))
      );
    else rpc['sources.retireHistory'].mockReturnValue(Effect.succeed(preview));

    const { queryClient } = mountLibraryRoute('/sources/7', rpc);

    await screen.findByText('Current source body');
    const key = ['sources', 'current-extraction', '7'];

    await act(async () => {
      queryClient.setQueryData(key, {
        ...preview.candidates[0],
        name: importedSource.name,
        document: old.document
      });
    });
    await screen.findByText('Old source body');
    const user = userEvent.setup();
    const dialog = await review(user);

    await user.click(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));

    if (uncertain) await within(dialog).findByText(t.SourceHistoryFailed);
    else await screen.findByText(t.SourceHistoryRemoved);

    expect(await screen.findByText('Current source body')).toBeVisible();
    expect(screen.queryByText('Old source body')).toBeNull();
    expect(queryClient.getQueryData(key)).toMatchObject({ snapshotId: current.snapshotId });
  }
);

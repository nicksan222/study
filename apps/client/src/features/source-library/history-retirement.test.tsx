import { StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { authoredPage } from '../document-editing/test-support';
import {
  importedSource,
  locationIs,
  materialRpc,
  mountLibraryRoute
} from '../material-library/test/support';

const t = catalogs.english;

function historyFixture({ vi }: Pick<test.unit.Context, 'vi'>) {
  const rpc = materialRpc({ vi });
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

async function review(
  {
    screen,
    within,
    waitFor,
    expect
  }: Pick<test.unit.Context, 'screen' | 'within' | 'waitFor' | 'expect'>,
  user: ReturnType<test.unit.Context['userEvent']['setup']>
) {
  await user.click(await screen.findByRole('button', { name: t.SourceHistoryPrune }));
  const dialog = await screen.findByRole('alertdialog');
  const name = within(dialog).getByRole('textbox', { name: t.SourceDeleteName });

  await waitFor(() => expect(name).toBeEnabled());
  await user.type(name, importedSource.name);

  return dialog;
}

test.unit.stable(
  'removes only reviewed source bodies and returns historical reading to current while preserving independent authored copies',
  async ({ userEvent, expect, screen, within, waitFor, render, rpcHandlersTransport, vi }) => {
    const { rpc, preview } = historyFixture({ vi });

    rpc['sources.retireHistory'].mockReturnValue(Effect.succeed(preview));
    mountLibraryRoute(
      { render, rpcHandlersTransport, vi },
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );

    const user = userEvent.setup();

    expect(await screen.findByText('Old source body')).toBeVisible();
    const dialog = await review({ screen, within, waitFor, expect }, user);

    expect(within(dialog).getByText(t.SourceHistoryHelp)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));
    expect(await screen.findByText(t.SourceHistoryRemoved)).toBeVisible();
    expect(await screen.findByText('Current source body')).toBeVisible();
    expect(rpc['sources.retireHistory']).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      keepLatest: 1,
      token: preview.token
    });
  }
);
test.unit.stable(
  'retains uncertain reviewed intent across remount and reconciles only when all reviewed identities are absent',
  async ({ userEvent, within, expect, act, screen, waitFor, render, rpcHandlersTransport, vi }) => {
    const { rpc, preview } = historyFixture({ vi });

    rpc['sources.retireHistory'].mockReturnValue(
      Effect.fail(new StudyError('transient', 'Lost response'))
    );
    const { router } = mountLibraryRoute(
      { render, rpcHandlersTransport, vi },
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );
    const user = userEvent.setup();
    const dialog = await review({ screen, within, waitFor, expect }, user);

    await user.click(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));
    expect(await within(dialog).findByText(t.SourceHistoryFailed)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: t.Cancel }));
    await act(() => router.navigate({ to: '/notes' }));
    await locationIs({ waitFor }, router, '/notes');
    await act(() => router.navigate({ to: '/sources/$sourceId', params: { sourceId: '7' } }));
    await locationIs({ waitFor }, router, '/sources/7');
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
test.unit.stable(
  'shows exact evidence blockers and cannot authorize their removal',
  async ({ userEvent, screen, expect, within, render, rpcHandlersTransport, vi }) => {
    const { rpc, old, preview } = historyFixture({ vi });

    rpc['sources.previewHistory'].mockReturnValue(
      Effect.succeed({ ...preview, blockedSnapshotIds: [old.snapshotId] })
    );
    mountLibraryRoute(
      { render, rpcHandlersTransport, vi },
      '/sources/7?sourceRevision=1&sourceSnapshot=1101',
      rpc
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.SourceHistoryPrune }));
    const dialog = await screen.findByRole('alertdialog');

    expect(await within(dialog).findByText(t.SourceHistoryPinned)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: t.SourceHistoryConfirm })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: t.Cancel }));
    expect(screen.getByText('Old source body')).toBeVisible();
    expect(rpc['sources.retireHistory']).not.toHaveBeenCalled();
  }
);

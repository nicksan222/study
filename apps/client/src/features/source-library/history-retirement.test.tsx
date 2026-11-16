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

async function review(user: ReturnType<typeof test.userEvent.setup>) {
  await user.click(await test.screen.findByRole('button', { name: t.SourceHistoryPrune }));
  const dialog = await test.screen.findByRole('alertdialog');
  const name = test.within(dialog).getByRole('textbox', { name: t.SourceDeleteName });

  await test.waitFor(() => test.expect(name).toBeEnabled());
  await user.type(name, importedSource.name);

  return dialog;
}

test.stable(
  'removes only reviewed source bodies and returns historical reading to current while preserving independent authored copies',
  async () => {
    const { rpc, preview } = historyFixture();

    rpc['sources.retireHistory'].mockReturnValue(Effect.succeed(preview));
    mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);

    const user = test.userEvent.setup();

    test.expect(await test.screen.findByText('Old source body')).toBeVisible();
    const dialog = await review(user);

    test.expect(test.within(dialog).getByText(t.SourceHistoryHelp)).toBeVisible();
    await user.click(test.within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));
    test.expect(await test.screen.findByText(t.SourceHistoryRemoved)).toBeVisible();
    test.expect(await test.screen.findByText('Current source body')).toBeVisible();
    test.expect(rpc['sources.retireHistory']).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      keepLatest: 1,
      token: preview.token
    });
  }
);
test.stable(
  'retains uncertain reviewed intent across remount and reconciles only when all reviewed identities are absent',
  async () => {
    const { rpc, preview } = historyFixture();

    rpc['sources.retireHistory'].mockReturnValue(
      Effect.fail(new StudyError('transient', 'Lost response'))
    );
    const { router } = mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    const user = test.userEvent.setup();
    const dialog = await review(user);

    await user.click(test.within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }));
    test.expect(await test.within(dialog).findByText(t.SourceHistoryFailed)).toBeVisible();
    await user.click(test.within(dialog).getByRole('button', { name: t.Cancel }));
    await test.act(() => router.navigate({ to: '/notes' }));
    await locationIs(router, '/notes');
    await test.act(() => router.navigate({ to: '/sources/$sourceId', params: { sourceId: '7' } }));
    await locationIs(router, '/sources/7');
    await user.click(await test.screen.findByRole('button', { name: t.SourceHistoryPrune }));
    const reopened = await test.screen.findByRole('alertdialog');

    test
      .expect(test.within(reopened).getByRole('button', { name: t.SourceHistoryConfirm }))
      .toBeDisabled();
    await user.click(test.within(reopened).getByRole('button', { name: t.SourceHistoryRecover }));
    test.expect(await test.within(reopened).findByText(t.SourceHistoryFailed)).toBeVisible();
    test
      .expect(test.within(reopened).getByRole('button', { name: t.SourceHistoryConfirm }))
      .toBeDisabled();
    rpc['sources.previewHistory'].mockReturnValue(
      Effect.succeed({ ...preview, candidates: [], token: 'c'.repeat(64) })
    );
    await user.click(test.within(reopened).getByRole('button', { name: t.SourceHistoryRecover }));
    test.expect(await test.screen.findByText(t.SourceHistoryReconciled)).toBeVisible();
    test.expect(rpc['sources.retireHistory']).toHaveBeenCalledTimes(1);
  }
);
test.stable('shows exact evidence blockers and cannot authorize their removal', async () => {
  const { rpc, old, preview } = historyFixture();

  rpc['sources.previewHistory'].mockReturnValue(
    Effect.succeed({ ...preview, blockedSnapshotIds: [old.snapshotId] })
  );
  mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
  const user = test.userEvent.setup();

  await user.click(await test.screen.findByRole('button', { name: t.SourceHistoryPrune }));
  const dialog = await test.screen.findByRole('alertdialog');

  test.expect(await test.within(dialog).findByText(t.SourceHistoryPinned)).toBeVisible();
  test
    .expect(test.within(dialog).getByRole('button', { name: t.SourceHistoryConfirm }))
    .toBeDisabled();
  await user.click(test.within(dialog).getByRole('button', { name: t.Cancel }));
  test.expect(test.screen.getByText('Old source body')).toBeVisible();
  test.expect(rpc['sources.retireHistory']).not.toHaveBeenCalled();
});

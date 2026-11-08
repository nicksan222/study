import { StudyError } from '@study/contracts/errors';
import { pageVersionIdSchema } from '@study/contracts/ids';
import { editOutcomeSchema } from '@study/contracts/pages/editing';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { runRequest } from '#web/lib/effect/runtime.ts';
import { createStudyQueryClient } from '#web/lib/query-client.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { authoredPage } from './test-support';

const material = (id = 41n) => ({
  ...authoredPage(id, 'Historical extraction', 101n),
  title: `Material ${id}`
});

const versionId = (id: string) => pageVersionIdSchema.make(BigInt(id));

import { materialRpc } from '../material-library/test/support';
import { PageActions } from './page-actions';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

function editorRpc() {
  const version = material().version!;

  const rpc = {
    ...materialRpc(),
    'pages.save': vi.fn<StudyClient['pages.save']>(),
    'pages.restore': vi.fn<StudyClient['pages.restore']>()
  };

  rpc['pages.page'].mockReturnValue(Effect.succeed({ ...material(), version }));
  rpc['pages.version'].mockReturnValue(Effect.succeed(version));

  return rpc;
}

const receipt = (submitted = 103n, expected = 101n, outcome = 'saved') =>
  Schema.decodeUnknownSync(editOutcomeSchema)({
    outcome,
    replayed: false,
    expectedVersionId: expected,
    currentVersionId: submitted,
    submittedVersionId: submitted
  });

async function startDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: catalogs.english.PageEdit }));
  const text = screen.getByRole('textbox', { name: `${catalogs.english.PageText} 1` });

  await user.clear(text);
  await user.type(text, 'My unsaved correction');
}

testStable(
  'retains an unsaved draft through a route absence longer than default query GC, then explicitly discards it',
  async () => {
    const version = material().version!;

    const client = createStudyQueryClient();
    const mount = () =>
      render(
        <QueryClientProvider client={client}>
          <PageActions version={version} current={version.id} />
        </QueryClientProvider>
      );
    const view = mount();
    const timedUser = userEvent.setup();

    try {
      await startDraft(timedUser);
      vi.useFakeTimers();
      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6 * 60_000);
      });
    } finally {
      vi.useRealTimers();
    }

    const user = userEvent.setup();
    const reopened = mount();

    try {
      expect(
        await screen.findByRole('textbox', { name: `${catalogs.english.PageText} 1` })
      ).toHaveValue('My unsaved correction');
      await user.click(screen.getByRole('button', { name: catalogs.english.PageCloseDraft }));
      await user.click(screen.getByRole('button', { name: catalogs.english.PageEdit }));
      expect(screen.getByRole('textbox', { name: `${catalogs.english.PageText} 1` })).toHaveValue(
        'Historical extraction'
      );
    } finally {
      reopened.unmount();
      client.clear();
    }
  }
);

testStable(
  'replays the immutable save and undo after lost responses and remount, and removes acknowledged undo',
  async () => {
    const rpc = editorRpc();

    rpc['pages.save']
      .mockReturnValueOnce(Effect.fail(new StudyError('internal', 'Response lost')))
      .mockReturnValueOnce(Effect.succeed({ ...receipt(), replayed: true }));
    rpc['pages.restore']
      .mockReturnValueOnce(Effect.fail(new StudyError('internal', 'Response lost')))
      .mockReturnValueOnce(Effect.succeed({ ...receipt(104n, 103n), replayed: true }));
    vi.mocked(request).mockImplementation((invoke, signal) =>
      runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
    );
    const client = createStudyQueryClient();
    const mount = () =>
      render(
        <QueryClientProvider client={client}>
          <PageActions version={material().version!} current={versionId('101')} />
        </QueryClientProvider>
      );
    let view = mount();
    const user = userEvent.setup();

    async function remount() {
      view.unmount();
      view = mount();
    }

    await startDraft(user);
    await user.click(screen.getByRole('button', { name: catalogs.english.PageSave }));
    await screen.findByText(catalogs.english.PageActionFailed);
    const save = rpc['pages.save'].mock.calls[0]![0];

    await remount();
    expect(
      await screen.findByRole('textbox', { name: `${catalogs.english.PageText} 1` })
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: catalogs.english.PageSave }));
    await screen.findByText(catalogs.english.PageSaved);
    expect(rpc['pages.save'].mock.calls[1]![0]).toEqual(save);
    expect(save.expectedVersionId).toBe(versionId('101'));
    expect(save.document.blocks[0]!.text).toBe('My unsaved correction');
    await user.click(screen.getByRole('button', { name: catalogs.english.PageUndo }));
    await screen.findByText(catalogs.english.PageActionFailed);
    const undo = rpc['pages.restore'].mock.calls[0]![0];

    expect(undo).toMatchObject({
      expectedVersionId: versionId('103'),
      restoreVersionId: versionId('101')
    });
    await remount();
    await user.click(await screen.findByRole('button', { name: catalogs.english.PageUndo }));
    await screen.findByText(catalogs.english.PageUndone);
    expect(rpc['pages.restore'].mock.calls[1]![0]).toEqual(undo);
    expect(screen.queryByRole('button', { name: catalogs.english.PageUndo })).toBeNull();
    await remount();
    await screen.findByText(catalogs.english.PageUndone);
    expect(screen.queryByRole('button', { name: catalogs.english.PageUndo })).toBeNull();
    expect(rpc['pages.restore']).toHaveBeenCalledTimes(2);
  }
);

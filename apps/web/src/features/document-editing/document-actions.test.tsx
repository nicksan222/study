import { editOutcomeSchema } from '@study/contracts/documents/editing';
import { StudyError } from '@study/contracts/errors';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { createStudyQueryClient } from '#web/lib/query-client.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';

import { authoredDocument } from './test-support';

const material = (id = 41n) => ({
  ...authoredDocument(id, 'Historical extraction', 101n),
  title: `Material ${id}`
});

const versionId = (id: string) => studyDocumentVersionIdSchema.make(BigInt(id));

import { materialRpc, mountLibraryRoute } from '../material-library/test/support';
import { DocumentActions } from './document-actions';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

function editorRpc() {
  const version = material().version!;

  const rpc = {
    ...materialRpc(),
    'documents.save': vi.fn<StudyClient['documents.save']>(),
    'documents.restore': vi.fn<StudyClient['documents.restore']>()
  };

  rpc['documents.document'].mockReturnValue(Effect.succeed({ ...material(), version }));
  rpc['documents.version'].mockReturnValue(Effect.succeed(version));

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
  await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentEdit }));
  const text = screen.getByRole('textbox', { name: `${catalogs.english.DocumentText} 1` });

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
          <DocumentActions version={version} current={version.id} />
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
        await screen.findByRole('textbox', { name: `${catalogs.english.DocumentText} 1` })
      ).toHaveValue('My unsaved correction');
      await user.click(screen.getByRole('button', { name: catalogs.english.DocumentCloseDraft }));
      await user.click(screen.getByRole('button', { name: catalogs.english.DocumentEdit }));
      expect(
        screen.getByRole('textbox', { name: `${catalogs.english.DocumentText} 1` })
      ).toHaveValue('Historical extraction');
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

    rpc['documents.save']
      .mockReturnValueOnce(Effect.fail(new StudyError('internal', 'Response lost')))
      .mockReturnValueOnce(Effect.succeed({ ...receipt(), replayed: true }));
    rpc['documents.restore']
      .mockReturnValueOnce(Effect.fail(new StudyError('internal', 'Response lost')))
      .mockReturnValueOnce(Effect.succeed({ ...receipt(104n, 103n), replayed: true }));
    const { router } = mountLibraryRoute('/documents/41?documentVersion=101', rpc);
    const user = userEvent.setup();

    async function remount() {
      await act(async () => {
        await router.navigate({ to: '/settings', search: {} });
      });
      await act(async () => {
        await router.navigate({
          to: '/documents/$documentId',
          params: { documentId: '41' },
          search: { documentVersion: '101' }
        });
      });
    }

    await startDraft(user);
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentSave }));
    await screen.findByText(catalogs.english.DocumentActionFailed);
    const save = rpc['documents.save'].mock.calls[0]![0];

    await remount();
    expect(
      await screen.findByRole('textbox', { name: `${catalogs.english.DocumentText} 1` })
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentSave }));
    await screen.findByText(catalogs.english.DocumentSaved);
    expect(rpc['documents.save'].mock.calls[1]![0]).toEqual(save);
    expect(save.expectedVersionId).toBe(versionId('101'));
    expect(save.document.blocks[0]!.text).toBe('My unsaved correction');
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentUndo }));
    await screen.findByText(catalogs.english.DocumentActionFailed);
    const undo = rpc['documents.restore'].mock.calls[0]![0];

    expect(undo).toMatchObject({
      expectedVersionId: versionId('103'),
      restoreVersionId: versionId('101')
    });
    await remount();
    await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentUndo }));
    await screen.findByText(catalogs.english.DocumentUndone);
    expect(rpc['documents.restore'].mock.calls[1]![0]).toEqual(undo);
    expect(screen.queryByRole('button', { name: catalogs.english.DocumentUndo })).toBeNull();
    await remount();
    await screen.findByText(catalogs.english.DocumentUndone);
    expect(screen.queryByRole('button', { name: catalogs.english.DocumentUndo })).toBeNull();
    expect(rpc['documents.restore']).toHaveBeenCalledTimes(2);
  }
);

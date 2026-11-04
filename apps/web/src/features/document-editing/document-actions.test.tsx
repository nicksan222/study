import { editOutcomeSchema } from '@study/contracts/documents/editing';
import { StudyError } from '@study/contracts/errors';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { deferred, materialRpc, mountLibraryRoute } from '../material-library/test/support';
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
    const { router } = mountLibraryRoute('/documents/41', rpc);
    const user = userEvent.setup();

    async function remount() {
      await act(async () => {
        await router.navigate({ to: '/settings', search: {} });
      });
      await act(async () => {
        await router.navigate({
          to: '/documents/$documentId',
          params: { documentId: '41' },
          search: {}
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

testStable('permits correction after a known creation rejection', async () => {
  const rpc = materialRpc();

  rpc['documents.create']
    .mockReturnValueOnce(Effect.fail(new StudyError('invalid_input', 'Rejected')))
    .mockReturnValueOnce(Effect.succeed(material()));
  mountLibraryRoute('/library', rpc);
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentNew }));
  const title = screen.getByRole('textbox', { name: catalogs.english.DocumentTitle });

  await user.type(title, 'Rejected title');
  await user.type(
    screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText }),
    'Initial notes'
  );
  await user.click(screen.getByRole('button', { name: catalogs.english.DocumentCreate }));
  await screen.findByText(catalogs.english.DocumentCreateRejected);
  await user.clear(title);
  await user.type(title, 'Corrected title');
  await user.click(screen.getByRole('button', { name: catalogs.english.DocumentCreate }));
  await screen.findByRole('heading', { name: 'Material 41' });
  expect(rpc['documents.create']).toHaveBeenCalledTimes(2);
  expect(rpc['documents.create'].mock.calls[1]![0]).toMatchObject({
    title: 'Corrected title',
    document: {
      blocks: [
        {
          kind: 'paragraph',
          text: 'Initial notes',
          content: {
            type: 'paragraph',
            inlines: [{ type: 'text', text: 'Initial notes', marks: [] }]
          },
          anchor: { type: 'authored' }
        }
      ]
    }
  });
});

testStable(
  'requires Library review and explicit acknowledgement before another uncertain creation',
  async () => {
    const rpc = materialRpc();

    rpc['documents.create'].mockReturnValue(
      Effect.fail(new StudyError('internal', 'Response lost'))
    );
    const { router } = mountLibraryRoute('/library', rpc);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentNew }));
    await user.type(
      screen.getByRole('textbox', { name: catalogs.english.DocumentTitle }),
      'Uncertain title'
    );
    await user.type(
      screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText }),
      'Initial notes'
    );
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentCreate }));
    await screen.findByText(catalogs.english.DocumentCreateUncertain);
    expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: catalogs.english.DocumentCreationReviewed })
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: catalogs.english.Close }));
    await user.click(screen.getByRole('button', { name: catalogs.english.DocumentNew }));
    expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
    await reopenCreation(router);
    expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
    const review = screen.getByRole('region', { name: catalogs.english.DocumentCreationReviewAll });

    await user.click(within(review).getByRole('button', { name: catalogs.english.LibraryRefresh }));
    await user.click(
      await screen.findByRole('button', { name: catalogs.english.DocumentCreationReviewed })
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeEnabled()
    );
    expect(rpc['documents.create']).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'retains a known created ID when later refresh fails and never resubmits creation',
  async () => {
    const rpc = materialRpc();

    rpc['documents.create'].mockReturnValue(Effect.succeed(material()));
    const { queryClient, router } = mountLibraryRoute('/library', rpc);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentNew }));
    await user.type(
      screen.getByRole('textbox', { name: catalogs.english.DocumentTitle }),
      'Created once'
    );
    await user.type(
      screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText }),
      'Initial notes'
    );
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('Refresh interrupted'));

    try {
      await user.click(screen.getByRole('button', { name: catalogs.english.DocumentCreate }));
      const open = await screen.findByRole('link', { name: catalogs.english.DocumentOpenCopy });

      expect(open).toHaveAttribute('href', '/documents/41');
      expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
      expect(
        screen.queryByRole('button', { name: catalogs.english.DocumentCreationReviewed })
      ).toBeNull();
      const title = screen.getByRole('textbox', { name: catalogs.english.DocumentTitle });

      await user.clear(title);
      await user.type(title, 'Later unsent title');
      const submitted = screen.getByRole('region', {
        name: catalogs.english.DocumentCreationSubmitted
      });

      expect(within(submitted).getByText('Created once')).toBeInTheDocument();
      await reopenCreation(router);
      expect(screen.getByRole('textbox', { name: catalogs.english.DocumentTitle })).toHaveValue(
        'Later unsent title'
      );
      expect(
        within(
          screen.getByRole('region', { name: catalogs.english.DocumentCreationSubmitted })
        ).getByText('Created once')
      ).toBeInTheDocument();
      const recovered = await screen.findByRole('link', {
        name: catalogs.english.DocumentOpenCopy
      });

      expect(recovered).toHaveAttribute('href', '/documents/41');
      expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
      await user.click(recovered);
      await screen.findByRole('heading', { name: 'Material 41' });
      await reopenCreation(router);
      await user.click(screen.getByRole('button', { name: catalogs.english.LibraryStartAnother }));
      expect(
        screen.queryByRole('region', { name: catalogs.english.DocumentCreationSubmitted })
      ).toBeNull();
      expect(screen.queryByRole('link', { name: catalogs.english.DocumentOpenCopy })).toBeNull();
      await waitFor(() =>
        expect(screen.getByRole('textbox', { name: catalogs.english.DocumentTitle })).toHaveValue(
          ''
        )
      );
      expect(
        screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText })
      ).toHaveValue('');
      expect(rpc['documents.create']).toHaveBeenCalledTimes(1);
    } finally {
      invalidate.mockRestore();
    }
  }
);

async function reopenCreation(router: ReturnType<typeof mountLibraryRoute>['router']) {
  await act(async () => {
    await router.navigate({ to: '/settings', search: {} });
  });
  await act(async () => {
    await router.navigate({ to: '/library', search: {} });
  });
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: catalogs.english.DocumentNew }));
}

testStable(
  'requires both title and nonempty body before creation and retains the draft across remount',
  async () => {
    const { rpc, router } = mountLibraryRoute();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentNew }));
    await user.type(
      screen.getByRole('textbox', { name: catalogs.english.DocumentTitle }),
      'My notes'
    );
    expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText }),
      '   '
    );
    expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText }),
      'Keep this draft'
    );
    await reopenCreation(router);
    expect(screen.getByRole('textbox', { name: catalogs.english.DocumentTitle })).toHaveValue(
      'My notes'
    );
    expect(screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText })).toHaveValue(
      '   Keep this draft'
    );
    expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeEnabled();
    expect(rpc['documents.create']).not.toHaveBeenCalled();
  }
);

testStable('retains the in-flight creation fence and known receipt across remount', async () => {
  const rpc = materialRpc();
  const response = deferred<ReturnType<typeof material>>();

  rpc['documents.create'].mockReturnValue(Effect.promise(() => response.promise));
  const { router } = mountLibraryRoute('/library', rpc);
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentNew }));
  await user.type(
    screen.getByRole('textbox', { name: catalogs.english.DocumentTitle }),
    'Pending notes'
  );
  await user.type(
    screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText }),
    'Body'
  );
  const form = screen
    .getByRole('textbox', { name: catalogs.english.DocumentTitle })
    .closest('form')!;

  // Repeated native submits must hit the synchronous fence before Query notifications render.

  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  await waitFor(() => expect(rpc['documents.create']).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('textbox', { name: catalogs.english.DocumentTitle })).toBeDisabled();
  expect(
    screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText })
  ).toBeDisabled();
  await reopenCreation(router);
  expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
  await act(async () => {
    response.resolve(material());
    await response.promise;
  });
  await screen.findByRole('heading', { name: 'Material 41' });
  await act(async () => {
    await router.navigate({ to: '/library', search: {} });
  });
  await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentNew }));
  expect(
    await screen.findByRole('link', { name: catalogs.english.DocumentOpenCopy })
  ).toHaveAttribute('href', '/documents/41');
  expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
  expect(rpc['documents.create']).toHaveBeenCalledTimes(1);
});

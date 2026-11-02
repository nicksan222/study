import { StudyError } from '@study/contracts/errors';
import { documentEditOutcomeSchema } from '@study/contracts/materials/editing';
import { materialVersionDetailSchema } from '@study/contracts/materials/schemas';
import { catalogs } from '@study/localization';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, it, vi } from 'vite-plus/test';

import { createStudyQueryClient } from '../../lib/query-client';
import type { StudyClient } from '../../lib/study-client/client';
import { versionId } from '../material-library/identity';
import {
  deferred,
  exactDocument,
  importedVersion,
  material,
  materialRpc,
  mountLibraryRoute
} from '../material-library/test/support';
import { DocumentActions } from './document-actions';

vi.mock('../../lib/study-client/request', () => ({ request: vi.fn() }));

function editorRpc() {
  const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
    ...importedVersion(),
    kind: 'document',
    content: { kind: 'document', ...exactDocument().document }
  });
  const rpc = {
    ...materialRpc(),
    'materials.saveDocument': vi.fn<StudyClient['materials.saveDocument']>(),
    'materials.undoDocument': vi.fn<StudyClient['materials.undoDocument']>()
  };
  rpc['materials.material'].mockReturnValue(
    Effect.succeed({ ...material(), kind: 'document', version })
  );
  rpc['materials.materialVersion'].mockReturnValue(Effect.succeed(version));
  return rpc;
}
const receipt = (submitted = 103n, expected = 101n, outcome = 'saved') =>
  Schema.decodeUnknownSync(documentEditOutcomeSchema)({
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

it('retains an unsaved draft through a route absence longer than default query GC, then explicitly discards it', async () => {
  const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
    ...importedVersion(),
    kind: 'document',
    content: { kind: 'document', ...exactDocument().document }
  });
  vi.useFakeTimers();
  const client = createStudyQueryClient();
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <DocumentActions version={version} current={version.id} />
      </QueryClientProvider>
    );
  const view = mount();
  const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  try {
    await startDraft(timedUser);
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
    expect(screen.getByRole('textbox', { name: `${catalogs.english.DocumentText} 1` })).toHaveValue(
      'Historical extraction'
    );
  } finally {
    reopened.unmount();
    client.clear();
  }
});

it('replays the immutable save and undo after lost responses and remount, and removes acknowledged undo', async () => {
  const rpc = editorRpc();
  rpc['materials.saveDocument']
    .mockReturnValueOnce(Effect.fail(new StudyError('internal', 'Response lost')))
    .mockReturnValueOnce(Effect.succeed({ ...receipt(), replayed: true }));
  rpc['materials.undoDocument']
    .mockReturnValueOnce(Effect.fail(new StudyError('internal', 'Response lost')))
    .mockReturnValueOnce(Effect.succeed({ ...receipt(104n, 103n), replayed: true }));
  const { router } = mountLibraryRoute('/materials/41', rpc);
  const user = userEvent.setup();
  async function remount() {
    await act(async () => {
      await router.navigate({ to: '/settings', search: {} });
    });
    await act(async () => {
      await router.navigate({
        to: '/materials/$materialId',
        params: { materialId: '41' },
        search: {}
      });
    });
  }
  await startDraft(user);
  await user.click(screen.getByRole('button', { name: catalogs.english.DocumentSave }));
  await screen.findByText(catalogs.english.DocumentActionFailed);
  const save = rpc['materials.saveDocument'].mock.calls[0]![0];
  await remount();
  expect(
    await screen.findByRole('textbox', { name: `${catalogs.english.DocumentText} 1` })
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: catalogs.english.DocumentSave }));
  await screen.findByText(catalogs.english.DocumentSaved);
  expect(rpc['materials.saveDocument'].mock.calls[1]![0]).toEqual(save);
  expect(save.expectedVersionId).toBe(versionId('101'));
  expect(save.document.blocks[0]!.text).toBe('My unsaved correction');
  await user.click(screen.getByRole('button', { name: catalogs.english.DocumentUndo }));
  await screen.findByText(catalogs.english.DocumentActionFailed);
  const undo = rpc['materials.undoDocument'].mock.calls[0]![0];
  expect(undo).toMatchObject({
    expectedVersionId: versionId('103'),
    restoreVersionId: versionId('101')
  });
  await remount();
  await user.click(await screen.findByRole('button', { name: catalogs.english.DocumentUndo }));
  await screen.findByText(catalogs.english.DocumentUndone);
  expect(rpc['materials.undoDocument'].mock.calls[1]![0]).toEqual(undo);
  expect(screen.queryByRole('button', { name: catalogs.english.DocumentUndo })).toBeNull();
  await remount();
  await screen.findByText(catalogs.english.DocumentUndone);
  expect(screen.queryByRole('button', { name: catalogs.english.DocumentUndo })).toBeNull();
  expect(rpc['materials.undoDocument']).toHaveBeenCalledTimes(2);
});

it('permits correction after a known creation rejection', async () => {
  const rpc = materialRpc();
  rpc['materials.createManualDocument']
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
  expect(rpc['materials.createManualDocument']).toHaveBeenCalledTimes(2);
  expect(rpc['materials.createManualDocument'].mock.calls[1]![0]).toMatchObject({
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

it('requires Library review and explicit acknowledgement before another uncertain creation', async () => {
  const rpc = materialRpc();
  rpc['materials.createManualDocument'].mockReturnValue(
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
  expect(rpc['materials.createManualDocument']).toHaveBeenCalledTimes(1);
});

it('retains a known created ID when later refresh fails and never resubmits creation', async () => {
  const rpc = materialRpc();
  rpc['materials.createManualDocument'].mockReturnValue(Effect.succeed(material()));
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
    expect(open).toHaveAttribute('href', '/materials/41');
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
    const recovered = await screen.findByRole('link', { name: catalogs.english.DocumentOpenCopy });
    expect(recovered).toHaveAttribute('href', '/materials/41');
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
      expect(screen.getByRole('textbox', { name: catalogs.english.DocumentTitle })).toHaveValue('')
    );
    expect(screen.getByRole('textbox', { name: catalogs.english.DocumentInitialText })).toHaveValue(
      ''
    );
    expect(rpc['materials.createManualDocument']).toHaveBeenCalledTimes(1);
  } finally {
    invalidate.mockRestore();
  }
});

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

it('requires both title and nonempty body before creation and retains the draft across remount', async () => {
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
  expect(rpc['materials.createManualDocument']).not.toHaveBeenCalled();
});

it('retains the in-flight creation fence and known receipt across remount', async () => {
  const rpc = materialRpc();
  const response = deferred<ReturnType<typeof material>>();
  rpc['materials.createManualDocument'].mockReturnValue(Effect.promise(() => response.promise));
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
  await waitFor(() => expect(rpc['materials.createManualDocument']).toHaveBeenCalledTimes(1));
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
  ).toHaveAttribute('href', '/materials/41');
  expect(screen.getByRole('button', { name: catalogs.english.DocumentCreate })).toBeDisabled();
  expect(rpc['materials.createManualDocument']).toHaveBeenCalledTimes(1);
});

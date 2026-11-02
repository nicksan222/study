import { StudyError } from '@study/contracts/errors';
import { createManualDocumentSchema } from '@study/contracts/materials/editing';
import { catalogs } from '@study/localization';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, it, vi } from 'vite-plus/test';

import { materialId, collectionId } from '../material-library/identity';
import { materialsOptions } from '../material-library/material-library.queries';
import {
  deferred,
  materialRpc,
  mountLibraryRoute,
  summary
} from '../material-library/test/support';

vi.mock('../../lib/study-client/request', () => ({ request: vi.fn() }));

const copy = catalogs.english;

const review = () => within(screen.getByRole('region', { name: copy.DocumentCreationReviewAll }));

const submitted = () => screen.getByRole('region', { name: copy.DocumentCreationSubmitted });

const create = () => screen.getByRole('button', { name: copy.DocumentCreate });

const acknowledged = () => screen.queryByRole('button', { name: copy.DocumentCreationReviewed });

async function loseCreation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: copy.DocumentNew }));
  await user.type(screen.getByRole('textbox', { name: copy.DocumentTitle }), 'Submitted A');
  await user.type(
    screen.getByRole('textbox', { name: copy.DocumentInitialText }),
    'Original body A'
  );
  await user.click(create());
  await screen.findByText(copy.DocumentCreateUncertain);
}

async function remount(router: ReturnType<typeof mountLibraryRoute>['router'], project?: string) {
  await act(async () => {
    await router.navigate({ to: '/settings', search: {} });
  });
  await act(async () => {
    await router.navigate({ to: '/library', search: project ? { project } : {} });
  });
  await userEvent.setup().click(await screen.findByRole('button', { name: copy.DocumentNew }));
}

it('keeps the exact submitted A Document and block identity separate from editable B through remount and explicit resolution', async () => {
  const rpc = materialRpc();

  rpc['materials.createManualDocument'].mockReturnValue(
    Effect.fail(new StudyError('internal', 'Response lost'))
  );
  const { router } = mountLibraryRoute('/library', rpc);
  const user = userEvent.setup();

  await loseCreation(user);
  const input = rpc['materials.createManualDocument'].mock.calls[0]![0];

  expect(Schema.decodeUnknownSync(createManualDocumentSchema)(input)).toEqual(input);
  expect(input).toMatchObject({
    title: 'Submitted A',
    document: {
      blocks: [
        {
          id: expect.any(String),
          kind: 'paragraph',
          text: 'Original body A',
          content: {
            type: 'paragraph',
            inlines: [{ type: 'text', text: 'Original body A', marks: [] }]
          },
          anchor: { type: 'authored' }
        }
      ]
    }
  });
  expect(input.document.blocks).toHaveLength(1);
  const title = screen.getByRole('textbox', { name: copy.DocumentTitle });
  const body = screen.getByRole('textbox', { name: copy.DocumentInitialText });

  await user.clear(title);
  await user.type(title, 'Draft B');
  await user.clear(body);
  await user.type(body, 'Unsent body B');
  await remount(router);
  expect(screen.getByRole('textbox', { name: copy.DocumentTitle })).toHaveValue('Draft B');
  expect(screen.getByRole('textbox', { name: copy.DocumentInitialText })).toHaveValue(
    'Unsent body B'
  );
  expect(within(submitted()).getByText('Submitted A')).toBeInTheDocument();
  expect(
    within(submitted()).getByText('Original body A').closest('[data-block-id]')
  ).toHaveAttribute('data-block-id', input.document.blocks[0]!.id);
  expect(within(submitted()).queryByText('Unsent body B')).toBeNull();
  expect(create()).toBeDisabled();
  await user.click(review().getByRole('button', { name: copy.LibraryRefresh }));
  await user.click(await screen.findByRole('button', { name: copy.DocumentCreationReviewed }));
  await waitFor(() => expect(create()).toBeEnabled());
  expect(screen.queryByRole('region', { name: copy.DocumentCreationSubmitted })).toBeNull();
  expect(screen.getByRole('textbox', { name: copy.DocumentTitle })).toHaveValue('Draft B');
  expect(rpc['materials.createManualDocument']).toHaveBeenCalledTimes(1);
  await user.click(create());
  await screen.findByText(copy.DocumentCreateUncertain);
  const next = rpc['materials.createManualDocument'].mock.calls[1]![0];

  expect(next.title).toBe('Draft B');
  expect(next.document.blocks[0]!.text).toBe('Unsent body B');
  expect(next.document.blocks[0]!.id).not.toBe(input.document.blocks[0]!.id);
});

it('reviews global RPC pages from a collection and requires the last page and a fresh explicit review after remount', async () => {
  const rpc = materialRpc();

  rpc['materials.createManualDocument'].mockReturnValue(
    Effect.fail(new StudyError('internal', 'Response lost'))
  );
  const first = deferred<{
    items: ReturnType<typeof summary>[];
    nextCursor: ReturnType<typeof materialId>;
  }>();
  const last = deferred<{ items: ReturnType<typeof summary>[]; nextCursor: null }>();

  rpc['materials.materials'].mockImplementation(({ projectId, cursor }) =>
    projectId
      ? Effect.succeed({ items: [summary(41n)], nextCursor: null })
      : cursor
        ? Effect.promise(() => last.promise)
        : Effect.promise(() => first.promise)
  );
  const { router, queryClient } = mountLibraryRoute('/library?project=3', rpc);
  const user = userEvent.setup();

  await loseCreation(user);
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: materialsOptions(collectionId('3')).queryKey });
  });
  expect(acknowledged()).toBeNull();
  expect(
    rpc['materials.materials'].mock.calls.every(([input]) => input.projectId === collectionId('3'))
  ).toBe(true);
  await user.click(review().getByRole('button', { name: copy.LibraryRefresh }));
  expect(acknowledged()).toBeNull();
  expect(create()).toBeDisabled();
  await act(async () => {
    first.resolve({ items: [summary(61n)], nextCursor: materialId('61') });
    await first.promise;
  });
  expect(await review().findByRole('link', { name: 'Material 61' })).toHaveAttribute(
    'href',
    '/materials/61'
  );
  expect(acknowledged()).toBeNull();
  await user.click(review().getByRole('button', { name: copy.LibraryMore }));
  expect(acknowledged()).toBeNull();
  expect(create()).toBeDisabled();
  await act(async () => {
    last.resolve({ items: [{ ...summary(99n), title: 'Submitted A' }], nextCursor: null });
    await last.promise;
  });
  expect(await review().findByRole('link', { name: 'Submitted A' })).toHaveAttribute(
    'href',
    '/materials/99'
  );
  await screen.findByRole('button', { name: copy.DocumentCreationReviewed });
  expect(
    rpc['materials.materials'].mock.calls
      .filter(([input]) => !input.projectId)
      .map(([input]) => input)
  ).toEqual([
    { limit: 30, archived: false, projectId: undefined, cursor: undefined },
    { limit: 30, archived: false, projectId: undefined, cursor: materialId('61') }
  ]);
  expect(router.state.location.search.project).toBe('3');
  await remount(router, '3');
  expect(acknowledged()).toBeNull();
  expect(create()).toBeDisabled();
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: materialsOptions(collectionId('3')).queryKey });
  });
  expect(acknowledged()).toBeNull();
  await user.click(review().getByRole('button', { name: copy.LibraryRefresh }));
  await user.click(await screen.findByRole('button', { name: copy.DocumentCreationReviewed }));
  await waitFor(() => expect(create()).toBeEnabled());
  expect(rpc['materials.createManualDocument']).toHaveBeenCalledTimes(1);
});

it.each(['first', 'next'] as const)(
  'blocks acknowledgement after a failed %s global page until successful explicit recovery',
  async (failedPage) => {
    const rpc = materialRpc();

    rpc['materials.createManualDocument'].mockReturnValue(
      Effect.fail(new StudyError('internal', 'Response lost'))
    );
    let fail = true;

    rpc['materials.materials'].mockImplementation(({ projectId, cursor }) => {
      if (projectId) return Effect.succeed({ items: [summary()], nextCursor: null });

      if (fail && (failedPage === 'first' || cursor))
        return Effect.fail(new StudyError('internal', 'Library unavailable'));

      return Effect.succeed({
        items: [summary(cursor ? 99n : 61n)],
        nextCursor: cursor ? null : materialId('61')
      });
    });
    mountLibraryRoute('/library?project=3', rpc);
    const user = userEvent.setup();

    await loseCreation(user);
    await user.click(review().getByRole('button', { name: copy.LibraryRefresh }));

    if (failedPage === 'next')
      await user.click(await review().findByRole('button', { name: copy.LibraryMore }));

    expect(await review().findByRole('alert')).toHaveTextContent(copy.LibraryLoadFailed);
    expect(acknowledged()).toBeNull();
    expect(create()).toBeDisabled();
    fail = false;
    await user.click(review().getByRole('button', { name: copy.LibraryRefresh }));
    await waitFor(() =>
      expect(review().getByRole('button', { name: copy.LibraryMore })).toBeEnabled()
    );
    await user.click(review().getByRole('button', { name: copy.LibraryMore }));
    await review().findByRole('link', { name: 'Material 99' });
    await screen.findByRole('button', { name: copy.DocumentCreationReviewed });
    expect(create()).toBeDisabled();
    expect(rpc['materials.createManualDocument']).toHaveBeenCalledTimes(1);
  }
);

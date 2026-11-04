import { createSchema } from '@study/contracts/documents/editing';
import { StudyError } from '@study/contracts/errors';
import { studyDocumentIdSchema } from '@study/contracts/ids';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { collectionId } from '../material-library/identity';
import { authoredDocument } from './test-support';

const materialId = (id: string) => studyDocumentIdSchema.make(BigInt(id));

const summary = (id = 41n) => ({ ...authoredDocument(id), title: `Material ${id}` });

import { documentsOptions as materialsOptions } from '#web/lib/study-client/documents.queries.ts';

import { deferred, materialRpc, mountLibraryRoute } from '../material-library/test/support';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

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

testStable(
  'keeps the exact submitted A Document and block identity separate from editable B through remount and explicit resolution',
  async () => {
    const rpc = materialRpc();

    rpc['documents.create'].mockReturnValue(
      Effect.fail(new StudyError('internal', 'Response lost'))
    );
    const { router } = mountLibraryRoute('/library', rpc);
    const user = userEvent.setup();

    await loseCreation(user);
    const input = rpc['documents.create'].mock.calls[0]![0];

    expect(Schema.decodeUnknownSync(createSchema)(input)).toEqual(input);
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
    expect(rpc['documents.create']).toHaveBeenCalledTimes(1);
    await user.click(create());
    await screen.findByText(copy.DocumentCreateUncertain);
    const next = rpc['documents.create'].mock.calls[1]![0];

    expect(next.title).toBe('Draft B');
    expect(next.document.blocks[0]!.text).toBe('Unsent body B');
    expect(next.document.blocks[0]!.id).not.toBe(input.document.blocks[0]!.id);
  }
);

testStable(
  'reviews global RPC pages from a collection and requires the last page and a fresh explicit review after remount',
  async () => {
    const rpc = materialRpc();

    rpc['documents.create'].mockReturnValue(
      Effect.fail(new StudyError('internal', 'Response lost'))
    );
    const first = deferred<{
      items: ReturnType<typeof summary>[];
      nextCursor: ReturnType<typeof materialId>;
    }>();
    const last = deferred<{ items: ReturnType<typeof summary>[]; nextCursor: null }>();

    rpc['documents.documents'].mockImplementation(({ projectId, cursor }) =>
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
      rpc['documents.documents'].mock.calls.every(
        ([input]) => input.projectId === collectionId('3')
      )
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
      '/documents/61'
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
      '/documents/99'
    );
    await screen.findByRole('button', { name: copy.DocumentCreationReviewed });
    expect(
      rpc['documents.documents'].mock.calls
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
    expect(rpc['documents.create']).toHaveBeenCalledTimes(1);
  }
);

testStable.each(['first', 'next'] as const)(
  'blocks acknowledgement after a failed %s global page until successful explicit recovery',
  async (failedPage) => {
    const rpc = materialRpc();

    rpc['documents.create'].mockReturnValue(
      Effect.fail(new StudyError('internal', 'Response lost'))
    );
    let fail = true;

    rpc['documents.documents'].mockImplementation(({ projectId, cursor }) => {
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
    expect(rpc['documents.create']).toHaveBeenCalledTimes(1);
  }
);

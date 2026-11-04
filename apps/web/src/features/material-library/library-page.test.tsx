import { studyDocumentIdSchema, sourceIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { collectionId, materialId, versionId } from './identity';
import { materialsOptions } from './material-library.queries';
import {
  deferred,
  importedSource,
  locationIs,
  materialRpc,
  mountLibraryRoute,
  scrollMain,
  settle,
  summary
} from './test/support';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

async function acceptImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  const dialog = await screen.findByRole('dialog');

  await user.type(
    within(dialog).getByRole('textbox', { name: catalogs.english.LibraryLink }),
    'https://example.com'
  );
  await user.click(within(dialog).getByRole('button', { name: catalogs.english.LibraryImport }));
  await within(dialog).findByText(catalogs.english.LibraryAccepted);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

function receipt() {
  return within(screen.getByText(catalogs.english.LibraryAccepted).closest('aside')!);
}

testStable(
  'preserves exact loaded pages, scroll and originating row on repeated Back/Forward POPs',
  async () => {
    const rpc = materialRpc();

    rpc['materials.materials'].mockImplementation(({ cursor }) =>
      Effect.succeed(
        cursor
          ? { items: [summary(41n)], nextCursor: null }
          : { items: [summary(61n)], nextCursor: materialId('61') }
      )
    );
    const { history, router, queryClient } = mountLibraryRoute('/library?project=3', rpc);
    const user = userEvent.setup();

    await screen.findByRole('link', { name: /Material 61/ });
    await user.click(screen.getByRole('button', { name: catalogs.english.LibraryMore }));
    const origin = await screen.findByRole('link', { name: /Material 41/ });
    const options = materialsOptions(collectionId('3'));
    const cached = queryClient.getQueryData(options.queryKey);

    expect(cached?.pages).toHaveLength(2);
    const main = await scrollMain(786);

    await user.click(origin);
    await locationIs(router, '/materials/41');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Material 41' })).toHaveFocus());
    expect(main.scrollTop).toBe(0);

    for (let cycle = 0; cycle < 3; cycle++) {
      main.scrollTop = 1400 + cycle;
      await act(async () => {
        history.back();
      });
      await locationIs(router, '/library');
      await waitFor(() => expect(screen.getByRole('link', { name: /Material 41/ })).toHaveFocus());
      expect(main.scrollTop).toBe(786);
      expect(router.state.location.search.project).toBe('3');
      expect(queryClient.getQueryData(options.queryKey)).toBe(cached);
      expect(cached?.pageParams).toEqual([undefined, materialId('61')]);
      await act(async () => {
        history.forward();
      });
      await locationIs(router, '/materials/41');
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Material 41' })).toHaveFocus()
      );
      expect(main.scrollTop).toBe(0);
    }

    expect(rpc['materials.materials']).toHaveBeenCalledTimes(2);
  }
);

testStable(
  'uses the Library heading when the original row is no longer in the authoritative cache',
  async () => {
    const { history, router, queryClient } = mountLibraryRoute();
    const user = userEvent.setup();
    const origin = await screen.findByRole('link', { name: /Material 41/ });
    const main = await scrollMain(244);

    await user.click(origin);
    await locationIs(router, '/materials/41');
    act(() =>
      queryClient.setQueryData(materialsOptions().queryKey, {
        pages: [{ items: [], nextCursor: null }],
        pageParams: [undefined]
      })
    );
    await act(async () => {
      history.back();
    });
    await locationIs(router, '/library');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: catalogs.english.SidebarLibrary, level: 2 })
      ).toHaveFocus()
    );
    expect(
      screen.getByRole('heading', { level: 2, name: catalogs.english.SidebarLibrary })
    ).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(main.scrollTop).toBe(244);
  }
);

testStable(
  'keeps a deferred import across Settings navigation without late navigation or duplicate mutation',
  async () => {
    const pending = deferred<typeof importedSource>();
    const rpc = materialRpc();

    rpc['sources.addLink'].mockReturnValue(Effect.promise(() => pending.promise));
    const { router } = mountLibraryRoute('/library', rpc);
    const user = userEvent.setup();

    await screen.findByRole('link', { name: /Material 41/ });
    await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
    let dialog = await screen.findByRole('dialog');

    await user.type(
      within(dialog).getByRole('textbox', { name: catalogs.english.LibraryLink }),
      'https://example.com'
    );
    await user.click(within(dialog).getByRole('button', { name: catalogs.english.LibraryImport }));
    await within(dialog).findByText(catalogs.english.LibraryImporting);
    await user.keyboard('{Escape}');
    await act(async () => {
      await router.navigate({ to: '/settings', search: {} });
    });
    await locationIs(router, '/settings');
    await act(async () => {
      pending.resolve(importedSource);
      await pending.promise;
    });
    await settle();
    expect(router.state.location.pathname).toBe('/settings');
    expect(screen.queryByText(catalogs.english.LibraryAccepted)).toBeNull();
    await act(async () => {
      await router.navigate({ to: '/library', search: {} });
    });
    await screen.findByText(catalogs.english.LibraryAccepted);
    await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
    dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: catalogs.english.LibraryImport })
    ).toBeDisabled();
    expect(rpc['sources.addLink']).toHaveBeenCalledExactlyOnceWith({
      url: 'https://example.com',
      projectId: null
    });
    expect(rpc['sources.createSource']).not.toHaveBeenCalled();
    expect(rpc['materials.materials']).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'does not let a deferred reveal replace the restored multipage browse snapshot',
  async () => {
    const rpc = materialRpc();

    rpc['materials.materials']
      .mockReturnValueOnce(
        Effect.succeed({
          items: [summary(61n)],
          nextCursor: materialId('61')
        })
      )
      .mockReturnValueOnce(Effect.succeed({ items: [summary(41n)], nextCursor: null }));
    const { queryClient, router } = mountLibraryRoute('/library', rpc);
    const user = userEvent.setup();

    await screen.findByRole('link', { name: /Material 61/ });
    await user.click(screen.getByRole('button', { name: catalogs.english.LibraryMore }));
    await screen.findByRole('link', { name: /Material 41/ });
    const main = await scrollMain(533);
    const cached = queryClient.getQueryData(materialsOptions().queryKey);

    await acceptImport(user);
    const reveal = deferred<{ items: ReturnType<typeof summary>[]; nextCursor: null }>();

    rpc['materials.materials'].mockReturnValueOnce(Effect.promise(() => reveal.promise));
    await user.click(receipt().getByRole('button', { name: catalogs.english.LibraryRefresh }));
    await waitFor(() => expect(rpc['materials.materials']).toHaveBeenCalledTimes(3));
    await user.click(receipt().getByRole('button', { name: catalogs.english.LibraryPrevious }));
    await locationIs(router, '/library');
    await waitFor(() => expect(main.scrollTop).toBe(533));
    await act(async () => {
      reveal.resolve({ items: [summary(99n)], nextCursor: null });
      await reveal.promise;
    });
    await settle();
    expect(queryClient.getQueryData(materialsOptions().queryKey)).toBe(cached);
    expect(main.scrollTop).toBe(533);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: catalogs.english.SidebarLibrary, level: 2 })
      ).toHaveFocus()
    );
    expect(screen.queryByRole('link', { name: /Material 99/ })).toBeNull();
    expect(screen.queryByText(catalogs.english.LibraryAccepted)).toBeNull();
    expect(rpc['sources.addLink']).toHaveBeenCalledTimes(1);
  }
);

testStable.each(['filter', 'settings', 'unmount'] as const)(
  'discards a deferred reveal after %s supersedes its view',
  async (destination) => {
    const { rpc, router, queryClient, unmount } = mountLibraryRoute();
    const user = userEvent.setup();

    await screen.findByRole('link', { name: /Material 41/ });
    await acceptImport(user);
    const cached = queryClient.getQueryData(materialsOptions().queryKey);
    const reveal = deferred<{ items: ReturnType<typeof summary>[]; nextCursor: null }>();

    rpc['materials.materials'].mockReturnValueOnce(Effect.promise(() => reveal.promise));
    await user.click(receipt().getByRole('button', { name: catalogs.english.LibraryRefresh }));
    await waitFor(() => expect(rpc['materials.materials']).toHaveBeenCalledTimes(2));

    if (destination === 'unmount') unmount();
    else
      await act(async () => {
        await router.navigate(
          destination === 'settings'
            ? { to: '/settings', search: {} }
            : { to: '/library', search: { project: '3' } }
        );
      });

    await act(async () => {
      reveal.resolve({ items: [summary(99n)], nextCursor: null });
      await reveal.promise;
    });
    await settle();
    expect(queryClient.getQueryData(materialsOptions().queryKey)).toBe(cached);
    expect(router.state.location.pathname).toBe(
      destination === 'settings' ? '/settings' : '/library'
    );
    expect(router.state.location.search.project).toBe(destination === 'filter' ? '3' : undefined);
    expect(screen.queryByRole('link', { name: /Material 99/ })).toBeNull();
    expect(rpc['sources.addLink']).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'invalidates reveal when filter navigation starts, before a delayed destination loader commits',
  async () => {
    const { rpc, router, queryClient } = mountLibraryRoute();
    const user = userEvent.setup();

    await screen.findByRole('link', { name: /Material 41/ });
    await acceptImport(user);
    const cached = queryClient.getQueryData(materialsOptions().queryKey);
    const reveal = deferred<{ items: ReturnType<typeof summary>[]; nextCursor: null }>();
    const filtered = deferred<{ items: ReturnType<typeof summary>[]; nextCursor: null }>();

    rpc['materials.materials']
      .mockReturnValueOnce(Effect.promise(() => reveal.promise))
      .mockReturnValueOnce(Effect.promise(() => filtered.promise));
    await user.click(receipt().getByRole('button', { name: catalogs.english.LibraryRefresh }));
    await waitFor(() => expect(rpc['materials.materials']).toHaveBeenCalledTimes(2));
    let navigation!: Promise<void>;

    act(() => {
      navigation = router.navigate({ to: '/library', search: { project: '3' } });
    });
    await waitFor(() => expect(rpc['materials.materials']).toHaveBeenCalledTimes(3));
    await act(async () => {
      reveal.resolve({ items: [summary(99n)], nextCursor: null });
      await reveal.promise;
    });
    await settle();
    expect(queryClient.getQueryData(materialsOptions().queryKey)).toBe(cached);
    await act(async () => {
      filtered.resolve({ items: [summary(71n)], nextCursor: null });
      await navigation;
    });
    await screen.findByRole('link', { name: /Material 71/ });
    expect(router.state.location.search.project).toBe('3');
    expect(queryClient.getQueryData(materialsOptions().queryKey)).toBe(cached);
    expect(rpc['materials.materials']).toHaveBeenCalledTimes(3);
  }
);

testStable(
  'restores submitted search, later draft text, collection, scroll and result focus on browser Back',
  async () => {
    const rpc = materialRpc();

    rpc['system.search'].mockReturnValue(
      Effect.succeed({
        semantic: false,
        hits: [
          {
            kind: 'material',
            title: 'Exact historical hit',
            at: 1n,
            excerpt: 'Matched old passage',
            target: {
              type: 'material',
              materialId: materialId('41'),
              versionId: versionId('101'),
              materialKind: 'diagram'
            }
          }
        ]
      })
    );
    const { history, router } = mountLibraryRoute('/library?project=3', rpc);
    const user = userEvent.setup();
    const search = await screen.findByRole('textbox', {
      name: catalogs.english.LibraryGlobalSearch
    });

    await user.type(search, 'old passage');
    await user.click(screen.getByRole('button', { name: catalogs.english.LibrarySearchAction }));
    const hit = await screen.findByRole('link', { name: 'Exact historical hit' });

    await user.type(search, ' unsent');
    const main = await scrollMain(455);

    await user.click(hit);
    await locationIs(router, '/materials/41');
    expect(router.state.location.search).toMatchObject({ project: '3', version: '101' });
    await screen.findByText(/Historical extraction/);
    await act(async () => {
      history.back();
    });
    await locationIs(router, '/library');
    expect(
      await screen.findByRole('textbox', { name: catalogs.english.LibraryGlobalSearch })
    ).toHaveValue('old passage unsent');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Exact historical hit' })).toHaveFocus()
    );
    expect(main.scrollTop).toBe(455);
    expect(rpc['system.search']).toHaveBeenCalledExactlyOnceWith({
      query: 'old passage',
      limit: 30
    });
  }
);

testStable(
  'opens accepted uploads directly as Sources even when absent from loaded Library pages',
  async () => {
    const rpc = materialRpc();

    mountLibraryRoute('/library', rpc);
    const user = userEvent.setup();

    await screen.findByRole('link', { name: /Material 41/ });
    await acceptImport(user);
    expect(
      await screen.findByRole('link', { name: catalogs.english.LibraryOpenAccepted })
    ).toHaveAttribute('href', `/sources/${importedSource.id}`);
    expect(screen.queryByRole('link', { name: /Material 99/ })).toBeNull();
  }
);

testStable(
  'searches authored outputs, sources and raw sessions through their distinct owning routes',
  async () => {
    const rpc = materialRpc();

    rpc['system.search'].mockReturnValue(
      Effect.succeed({
        semantic: false,
        hits: [
          {
            kind: 'document',
            title: 'Authored output',
            at: 1n,
            target: { type: 'document', documentId: studyDocumentIdSchema.make(41n) }
          },
          {
            kind: 'source',
            title: 'Original upload',
            at: 1n,
            target: { type: 'source', sourceId: sourceIdSchema.make(41n) }
          },
          {
            kind: 'session',
            title: 'Raw conversation',
            at: 1n,
            target: { type: 'session', sessionId: sessionIdSchema.make(41n) }
          }
        ]
      })
    );
    mountLibraryRoute('/library?project=3', rpc);
    const user = userEvent.setup();

    await user.type(
      await screen.findByRole('textbox', { name: catalogs.english.LibraryGlobalSearch }),
      'evidence'
    );
    await user.click(screen.getByRole('button', { name: catalogs.english.LibrarySearchAction }));
    expect(await screen.findByRole('link', { name: 'Authored output' })).toHaveAttribute(
      'href',
      '/documents/41?project=3'
    );
    expect(screen.getByRole('link', { name: 'Original upload' })).toHaveAttribute(
      'href',
      '/sources/41?project=3'
    );
    expect(screen.getByRole('link', { name: 'Raw conversation' })).toHaveAttribute(
      'href',
      '/sessions/41?project=3'
    );
  }
);

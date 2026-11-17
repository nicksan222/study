import { StudyError } from '@study/contracts';
import { catalogs, createLocalization } from '@study/localization';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { authoredPage } from '../document-editing/test-support';
import {
  deferred,
  materialRpc,
  mountLibraryRoute,
  importedSource
} from '../material-library/test/support';

const t = catalogs.english;
const { date } = createLocalization('english');

function extractionLabel(revision: bigint, createdAt: bigint) {
  const version = `${t.ReaderVersion} ${revision}`;
  const timestamp = date(createdAt, { dateStyle: 'medium', timeStyle: 'medium' });

  return (name: string) => name.startsWith(version) && name.endsWith(timestamp);
}

test.unit.stable(
  'opens an exact authored history version and explicitly returns to its independent current head',
  async ({ userEvent, within, screen, expect, act, waitFor, vi, render, rpcHandlersTransport }) => {
    const rpc = materialRpc({ vi });
    const current = authoredPage(41n, 'Current authored body', 103n);
    const old = authoredPage(41n, 'Historical authored body', 91n).version!;

    const history = { items: [current.version!, old], nextCursor: null };
    const versions = deferred<typeof history>();
    const user = userEvent.setup();

    rpc['pages.page'].mockReturnValue(Effect.succeed(current));
    rpc['pages.versions'].mockReturnValue(Effect.promise(() => versions.promise));
    rpc['pages.version'].mockImplementation(({ id }) =>
      Effect.succeed(id === old.id ? old : current.version!)
    );
    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/pages/41', rpc);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('Current authored body')).toBeVisible();
    const previous = await main.findByRole('button', { name: t.NotePreviousVersion });

    expect(previous).toBeDisabled();
    await act(async () => versions.resolve(history));
    await waitFor(() => expect(previous).toBeEnabled());
    await user.click(previous);
    expect(await main.findByText('Historical authored body')).toBeVisible();
    expect(main.queryByText('Current authored body')).toBeNull();
    await waitFor(() => expect(rpc['pages.version']).toHaveBeenCalledWith({ id: old.id }));
    expect(rpc['sources.currentExtraction']).not.toHaveBeenCalled();
    expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    const next = main.getByRole('button', { name: t.NoteNextVersion });

    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    expect(await main.findByText('Current authored body')).toBeVisible();
  }
);

test.unit.stable(
  'selects distinct source extractions within one original revision without following the latest extraction',
  async ({ within, screen, userEvent, expect, waitFor, vi, render, rpcHandlersTransport }) => {
    const rpc = materialRpc({ vi });
    const sourceId = importedSource.id;
    const oldest = authoredPage(41n, 'First extraction', 1001n).version!;
    const corrected = authoredPage(41n, 'Corrected extraction', 1002n).version!;
    const current = authoredPage(41n, 'Replacement extraction', 2001n).version!;

    rpc['sources.currentExtraction'].mockReturnValue(
      Effect.succeed({
        sourceId,
        revision: 2n,
        snapshotId: current.snapshotId,
        name: importedSource.name,
        document: current.document
      })
    );
    rpc['sources.extractions'].mockReturnValue(
      Effect.succeed({
        items: [
          { sourceId, revision: 2n, snapshotId: current.snapshotId, createdAt: 3n },
          { sourceId, revision: 1n, snapshotId: corrected.snapshotId, createdAt: 2n },
          { sourceId, revision: 1n, snapshotId: oldest.snapshotId, createdAt: 1n }
        ],
        next: null
      })
    );
    rpc['sources.extraction'].mockImplementation((input) =>
      Effect.succeed({
        ...input,
        name: importedSource.name,
        document: input.snapshotId === oldest.snapshotId ? oldest.document : corrected.document
      })
    );
    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/sources/7', rpc);
    const main = within(await screen.findByRole('main'));
    const user = userEvent.setup();

    expect(await main.findByText('Replacement extraction')).toBeVisible();
    await user.click(main.getByRole('button', { name: t.ReaderHistory }));
    await screen.findByRole('dialog', { name: t.ReaderHistory });
    const history = () => within(screen.getByRole('dialog', { name: t.ReaderHistory }));
    await user.click(
      await history().findByRole('button', {
        name: extractionLabel(1n, 1n)
      })
    );
    expect(await main.findByText('First extraction')).toBeVisible();
    expect(main.queryByText('Replacement extraction')).toBeNull();
    await waitFor(() =>
      expect(rpc['sources.extraction']).toHaveBeenLastCalledWith({
        sourceId,
        revision: 1n,
        snapshotId: oldest.snapshotId
      })
    );
    await user.click(main.getByRole('button', { name: t.ReaderHistory }));
    await user.click(history().getByRole('button', { name: extractionLabel(1n, 2n) }));
    expect(await main.findByText('Corrected extraction')).toBeVisible();
    expect(rpc['sources.extraction']).toHaveBeenLastCalledWith({
      sourceId,
      revision: 1n,
      snapshotId: corrected.snapshotId
    });
    expect(rpc['pages.create']).not.toHaveBeenCalled();
    expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    await user.click(main.getByRole('button', { name: t.ReaderHistory }));
    await user.click(history().getByRole('button', { name: t.ReaderCurrent }));
    expect(await main.findByText('Replacement extraction')).toBeVisible();
  }
);

test.unit.stable(
  'follows same-owner exact URL changes, current selection and browser history without falling back from missing versions',
  async ({ screen, expect, act, vi, render, rpcHandlersTransport }) => {
    const rpc = materialRpc({ vi });
    const current = authoredPage(41n, 'URL current body', 103n);
    const a = authoredPage(41n, 'URL exact A', 91n).version!;
    const b = authoredPage(41n, 'URL exact B', 92n).version!;

    rpc['pages.page'].mockReturnValue(Effect.succeed(current));
    rpc['pages.version'].mockImplementation(({ id }) =>
      id === a.id
        ? Effect.succeed(a)
        : id === b.id
          ? Effect.succeed(b)
          : id === current.version!.id
            ? Effect.succeed(current.version!)
            : Effect.fail(new StudyError('not_found', 'Retired'))
    );
    const view = mountLibraryRoute(
      { render, rpcHandlersTransport, vi },
      '/pages/41?pageVersion=91',
      rpc
    );

    await screen.findByText('URL exact A');
    const go = async ({ act }: Pick<test.unit.Context, 'act'>, pageVersion?: string) =>
      act(async () => {
        await view.router.navigate({
          to: '/pages/$pageId',
          params: { pageId: '41' },
          search: { pageVersion }
        });
      });

    await go({ act }, '92');
    expect(await screen.findByText('URL exact B')).toBeVisible();
    await act(async () => {
      view.history.back();
    });
    expect(await screen.findByText('URL exact A')).toBeVisible();
    await act(async () => {
      view.history.forward();
    });
    expect(await screen.findByText('URL exact B')).toBeVisible();
    await go({ act });
    expect(await screen.findByText('URL current body')).toBeVisible();
    await go({ act }, '91');
    expect(await screen.findByText('URL exact A')).toBeVisible();
    await go({ act }, '999');
    expect(await screen.findByText(t.NoteReadUnavailable)).toBeVisible();
    expect(screen.queryByText('URL current body')).toBeNull();
    expect(screen.queryByText('URL exact A')).toBeNull();
  }
);

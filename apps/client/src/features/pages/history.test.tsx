import { StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
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

test.stable(
  'opens an exact authored history version and explicitly returns to its independent current head',
  async () => {
    const rpc = materialRpc();
    const current = authoredPage(41n, 'Current authored body', 103n);
    const old = authoredPage(41n, 'Historical authored body', 91n).version!;

    const history = { items: [current.version!, old], nextCursor: null };
    const versions = deferred<typeof history>();
    const user = test.userEvent.setup();

    rpc['pages.page'].mockReturnValue(Effect.succeed(current));
    rpc['pages.versions'].mockReturnValue(Effect.promise(() => versions.promise));
    rpc['pages.version'].mockImplementation(({ id }) =>
      Effect.succeed(id === old.id ? old : current.version!)
    );
    mountLibraryRoute('/pages/41', rpc);
    const main = test.within(await test.screen.findByRole('main'));

    test.expect(await main.findByText('Current authored body')).toBeVisible();
    const previous = await main.findByRole('button', { name: t.NotePreviousVersion });

    test.expect(previous).toBeDisabled();
    await test.act(async () => versions.resolve(history));
    await test.waitFor(() => test.expect(previous).toBeEnabled());
    await user.click(previous);
    test.expect(await main.findByText('Historical authored body')).toBeVisible();
    test.expect(main.queryByText('Current authored body')).toBeNull();
    await test.waitFor(() =>
      test.expect(rpc['pages.version']).toHaveBeenCalledWith({ id: old.id })
    );
    test.expect(rpc['sources.currentExtraction']).not.toHaveBeenCalled();
    test.expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    const next = main.getByRole('button', { name: t.NoteNextVersion });

    await test.waitFor(() => test.expect(next).toBeEnabled());
    await user.click(next);
    test.expect(await main.findByText('Current authored body')).toBeVisible();
  }
);

test.stable(
  'selects distinct source extractions within one original revision without following the latest extraction',
  async () => {
    const rpc = materialRpc();
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
    mountLibraryRoute('/sources/7', rpc);
    const main = test.within(await test.screen.findByRole('main'));
    const user = test.userEvent.setup();

    test.expect(await main.findByText('Replacement extraction')).toBeVisible();
    await user.click(main.getByText(t.ReaderHistory, { selector: 'summary' }));
    await user.click(
      await main.findByRole('button', {
        name: `${t.ReaderVersion} 1 · ${oldest.snapshotId}`
      })
    );
    test.expect(await main.findByText('First extraction')).toBeVisible();
    test.expect(main.queryByText('Replacement extraction')).toBeNull();
    await test.waitFor(() =>
      test.expect(rpc['sources.extraction']).toHaveBeenLastCalledWith({
        sourceId,
        revision: 1n,
        snapshotId: oldest.snapshotId
      })
    );
    await user.click(
      main.getByRole('button', {
        name: `${t.ReaderVersion} 1 · ${corrected.snapshotId}`
      })
    );
    test.expect(await main.findByText('Corrected extraction')).toBeVisible();
    test.expect(rpc['sources.extraction']).toHaveBeenLastCalledWith({
      sourceId,
      revision: 1n,
      snapshotId: corrected.snapshotId
    });
    test.expect(rpc['pages.create']).not.toHaveBeenCalled();
    test.expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    await user.click(main.getByRole('button', { name: t.ReaderCurrent }));
    test.expect(await main.findByText('Replacement extraction')).toBeVisible();
  }
);

test.stable(
  'follows same-owner exact URL changes, current selection and browser history without falling back from missing versions',
  async () => {
    const rpc = materialRpc();
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
    const view = mountLibraryRoute('/pages/41?pageVersion=91', rpc);

    await test.screen.findByText('URL exact A');
    const go = async (pageVersion?: string) =>
      test.act(async () => {
        await view.router.navigate({
          to: '/pages/$pageId',
          params: { pageId: '41' },
          search: { pageVersion }
        });
      });

    await go('92');
    test.expect(await test.screen.findByText('URL exact B')).toBeVisible();
    await test.act(async () => {
      view.history.back();
    });
    test.expect(await test.screen.findByText('URL exact A')).toBeVisible();
    await test.act(async () => {
      view.history.forward();
    });
    test.expect(await test.screen.findByText('URL exact B')).toBeVisible();
    await go();
    test.expect(await test.screen.findByText('URL current body')).toBeVisible();
    await go('91');
    test.expect(await test.screen.findByText('URL exact A')).toBeVisible();
    await go('999');
    test.expect(await test.screen.findByText(t.NoteReadUnavailable)).toBeVisible();
    test.expect(test.screen.queryByText('URL current body')).toBeNull();
    test.expect(test.screen.queryByText('URL exact A')).toBeNull();
  }
);

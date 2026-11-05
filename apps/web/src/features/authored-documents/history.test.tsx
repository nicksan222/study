import { StudyError } from '@study/contracts/errors';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { authoredDocument } from '../document-editing/test-support';
import { materialRpc, mountLibraryRoute, importedSource } from '../material-library/test/support';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const t = catalogs.english;

testStable(
  'opens an exact authored history version and explicitly returns to its independent current head',
  async () => {
    const rpc = materialRpc();
    const current = authoredDocument(41n, 'Current authored body', 103n);
    const old = authoredDocument(41n, 'Historical authored body', 91n).version!;

    rpc['documents.document'].mockReturnValue(Effect.succeed(current));
    rpc['documents.versions'].mockReturnValue(
      Effect.succeed({ items: [current.version!, old], nextCursor: null })
    );
    rpc['documents.version'].mockImplementation(({ id }) =>
      Effect.succeed(id === old.id ? old : current.version!)
    );
    mountLibraryRoute('/documents/41', rpc);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('Current authored body')).toBeVisible();
    await userEvent
      .setup()
      .click(await main.findByRole('button', { name: t.SessionPreviousVersion }));
    expect(await main.findByText('Historical authored body')).toBeVisible();
    expect(main.queryByText('Current authored body')).toBeNull();
    await waitFor(() => expect(rpc['documents.version']).toHaveBeenCalledWith({ id: old.id }));
    expect(rpc['sources.currentExtraction']).not.toHaveBeenCalled();
    expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    await userEvent.setup().click(main.getByRole('button', { name: t.SessionNextVersion }));
    expect(await main.findByText('Current authored body')).toBeVisible();
  }
);

testStable(
  'selects distinct source extractions within one original revision without following the latest extraction',
  async () => {
    const rpc = materialRpc();
    const sourceId = importedSource.id;
    const oldest = authoredDocument(41n, 'First extraction', 1001n).version!;
    const corrected = authoredDocument(41n, 'Corrected extraction', 1002n).version!;
    const current = authoredDocument(41n, 'Replacement extraction', 2001n).version!;

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
    const main = within(await screen.findByRole('main'));
    const user = userEvent.setup();

    expect(await main.findByText('Replacement extraction')).toBeVisible();
    await user.click(main.getByText(t.ReaderHistory, { selector: 'summary' }));
    await user.click(
      await main.findByRole('button', {
        name: `${t.ReaderVersion} 1 · ${oldest.snapshotId}`
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
    await user.click(
      main.getByRole('button', {
        name: `${t.ReaderVersion} 1 · ${corrected.snapshotId}`
      })
    );
    expect(await main.findByText('Corrected extraction')).toBeVisible();
    expect(rpc['sources.extraction']).toHaveBeenLastCalledWith({
      sourceId,
      revision: 1n,
      snapshotId: corrected.snapshotId
    });
    expect(rpc['documents.create']).not.toHaveBeenCalled();
    expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    await user.click(main.getByRole('button', { name: t.ReaderCurrent }));
    expect(await main.findByText('Replacement extraction')).toBeVisible();
  }
);

testStable(
  'follows same-owner exact URL changes, current selection and browser history without falling back from missing versions',
  async () => {
    const rpc = materialRpc();
    const current = authoredDocument(41n, 'URL current body', 103n);
    const a = authoredDocument(41n, 'URL exact A', 91n).version!;
    const b = authoredDocument(41n, 'URL exact B', 92n).version!;

    rpc['documents.document'].mockReturnValue(Effect.succeed(current));
    rpc['documents.version'].mockImplementation(({ id }) =>
      id === a.id
        ? Effect.succeed(a)
        : id === b.id
          ? Effect.succeed(b)
          : id === current.version!.id
            ? Effect.succeed(current.version!)
            : Effect.fail(new StudyError('not_found', 'Retired'))
    );
    const view = mountLibraryRoute('/documents/41?documentVersion=91', rpc);
    const draftKey = ['document-editor', '20', '201'];

    view.queryClient.setQueryData(draftKey, { text: 'Unrelated unsaved draft' });
    await screen.findByText('URL exact A');
    const go = async (documentVersion?: string) =>
      act(async () => {
        await view.router.navigate({
          to: '/documents/$documentId',
          params: { documentId: '41' },
          search: { documentVersion }
        });
      });

    await go('92');
    expect(await screen.findByText('URL exact B')).toBeVisible();
    await act(async () => {
      view.history.back();
    });
    expect(await screen.findByText('URL exact A')).toBeVisible();
    await act(async () => {
      view.history.forward();
    });
    expect(await screen.findByText('URL exact B')).toBeVisible();
    await go();
    expect(await screen.findByText('URL current body')).toBeVisible();
    await go('91');
    expect(await screen.findByText('URL exact A')).toBeVisible();
    await go('999');
    expect(await screen.findByText(t.SessionReadUnavailable)).toBeVisible();
    expect(screen.queryByText('URL current body')).toBeNull();
    expect(screen.queryByText('URL exact A')).toBeNull();
    expect(view.queryClient.getQueryData(draftKey)).toEqual({ text: 'Unrelated unsaved draft' });
  }
);

import { StudyError, sourceIdSchema, createBlock, revisionExportSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { authoredPage } from '../document-editing/test-support';
import { deferred } from '../material-library/test/support';
import { AuthoredPageReader } from './reader';

test.unit.stable(
  'retries the exact document and individual image, avoids falling back to the current head, and releases URLs on replacement/unmount',
  async ({ vi, rpcHandlersTransport, render, userEvent, screen, expect, act, waitFor }) => {
    const page = authoredPage(41n, 'Current page', 20n);
    const document = authoredPage(41n).version!;
    const block = createBlock({
      type: 'image',
      sourceId: Schema.decodeUnknownSync(sourceIdSchema)(7n),
      revision: 1,
      alt: 'Retained figure'
    });
    const value = {
      ...document,
      document: { ...document.document, blocks: [block] }
    };
    const image = Schema.decodeUnknownSync(revisionExportSchema)({
      sourceId: 7n,
      revision: 1n,
      name: 'figure.png',
      mime: 'image/png',
      bytes: new Uint8Array([1])
    });
    const pending = deferred<typeof image>();
    const rpc = {
      'pages.page': () => Effect.succeed(page),
      'pages.versions': () => Effect.succeed({ items: [], nextCursor: null }),
      'pages.version': vi
        .fn<StudyClient['pages.version']>()
        .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Document read interrupted')))
        .mockReturnValue(Effect.succeed(value)),
      'sources.exportRevision': vi
        .fn<StudyClient['sources.exportRevision']>()
        .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Image read interrupted')))
        .mockReturnValueOnce(Effect.promise(() => pending.promise))
        .mockReturnValue(Effect.succeed({ ...image, bytes: new Uint8Array([2]) }))
    };

    const create = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:replacement');
    const revoke = vi.fn();

    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      }
    );
    const harness = rpcHandlersTransport(rpc);
    const view = render(
      <harness.wrapper>
        <AuthoredPageReader id={document.pageId} initialVersion={String(document.id)} />
      </harness.wrapper>
    );
    const user = userEvent.setup();

    try {
      await screen.findByText(catalogs.english.NoteReadErrorTitle);
      expect(screen.queryByText('Current page')).toBeNull();
      await user.click(screen.getByRole('button', { name: catalogs.english.Retry }));
      await screen.findByText(catalogs.english.ReaderReadFailed);
      expect(screen.queryByAltText('Retained figure')?.getAttribute('src')).toBeFalsy();
      await user.click(screen.getByRole('button', { name: catalogs.english.Retry }));
      await waitFor(() => expect(rpc['sources.exportRevision']).toHaveBeenCalledTimes(2));
      expect(screen.queryByAltText('Retained figure')?.getAttribute('src')).toBeFalsy();
      await act(async () => {
        pending.resolve(image);
        await pending.promise;
      });
      await waitFor(() =>
        expect(screen.getByAltText('Retained figure')).toHaveAttribute('src', 'blob:first')
      );
      expect(rpc['pages.version']).toHaveBeenCalledTimes(2);
      expect(rpc['sources.exportRevision']).toHaveBeenCalledTimes(2);

      for (const [input] of rpc['pages.version'].mock.calls) {
        expect(input).toEqual({ id: document.id });
      }

      for (const [input] of rpc['sources.exportRevision'].mock.calls) {
        expect(input).toEqual({
          sourceId: block.content.type === 'image' ? block.content.sourceId : undefined,
          revision: 1n
        });
      }

      await act(async () => {
        await harness.notify();
      });
      await waitFor(() =>
        expect(screen.getByAltText('Retained figure')).toHaveAttribute('src', 'blob:replacement')
      );
      expect(revoke).toHaveBeenCalledWith('blob:first');
      view.unmount();
      expect(revoke).toHaveBeenCalledWith('blob:replacement');
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();

      vi.unstubAllGlobals();
    }
  }
);

test.unit.stable(
  'retries one failed image without reacquiring an already displayed neighbor',
  async ({ vi, rpcHandlersTransport, render, screen, userEvent, expect, waitFor }) => {
    const page = authoredPage(41n, 'Current page', 20n);
    const base = authoredPage(41n).version!;
    const asset = Schema.decodeUnknownSync(revisionExportSchema)({
      sourceId: 7n,
      revision: 1n,
      name: 'figure.png',
      mime: 'image/png',
      bytes: new Uint8Array([1])
    });
    const first = createBlock({
      type: 'image',
      sourceId: asset.sourceId,
      revision: 1,
      alt: 'Interrupted figure'
    });
    const neighbor = createBlock({
      type: 'image',
      sourceId: Schema.decodeUnknownSync(sourceIdSchema)(8n),
      revision: 1,
      alt: 'Available neighbor'
    });
    const document = { ...base, document: { ...base.document, blocks: [first, neighbor] } };
    let interrupted = true;
    const rpc = {
      'pages.page': () => Effect.succeed(page),
      'pages.versions': () => Effect.succeed({ items: [], nextCursor: null }),
      'pages.version': vi
        .fn<StudyClient['pages.version']>()
        .mockReturnValue(Effect.succeed(document)),
      'sources.exportRevision': vi
        .fn<StudyClient['sources.exportRevision']>()
        .mockImplementation(({ sourceId }) => {
          if (sourceId === asset.sourceId && interrupted) {
            interrupted = false;

            return Effect.fail(new StudyError('transient', 'Interrupted'));
          }

          return Effect.succeed({ ...asset, sourceId });
        })
    };

    const revoke = vi.fn();
    let urlNumber = 0;

    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = () => `blob:figure-${++urlNumber}`;
        static revokeObjectURL = revoke;
      }
    );
    const harness = rpcHandlersTransport(rpc);
    const view = render(
      <harness.wrapper>
        <AuthoredPageReader id={document.pageId} initialVersion={String(document.id)} />
      </harness.wrapper>
    );

    try {
      const visible = await screen.findByAltText('Available neighbor');

      await waitFor(() => expect(visible).toHaveAttribute('src', 'blob:figure-1'));

      const url = visible.getAttribute('src');

      await userEvent
        .setup()
        .click(await screen.findByRole('button', { name: catalogs.english.Retry }));
      await waitFor(() =>
        expect(screen.getByAltText('Interrupted figure')).toHaveAttribute('src', 'blob:figure-2')
      );
      expect(screen.getByAltText('Available neighbor')).toHaveAttribute('src', url);
      const calls = rpc['sources.exportRevision'].mock.calls.map(([input]) => input);

      expect(calls.filter((input) => input.sourceId !== asset.sourceId)).toHaveLength(1);
      expect(calls.filter((input) => input.sourceId === asset.sourceId)).toHaveLength(2);
      expect(revoke).not.toHaveBeenCalled();
      view.unmount();
      expect(revoke).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();

      vi.unstubAllGlobals();
    }
  }
);

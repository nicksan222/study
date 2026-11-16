import { StudyError, sourceIdSchema, createBlock, revisionExportSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { authoredPage } from '../document-editing/test-support';
import { deferred } from '../material-library/test/support';
import { ExactAuthoredPageContent } from './exact-page';

test.stable(
  'retries the exact document and individual image, distinguishes loading, and releases URLs on replacement/unmount',
  async () => {
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
      'pages.version': test.vi
        .fn<StudyClient['pages.version']>()
        .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Document read interrupted')))
        .mockReturnValue(Effect.succeed(value)),
      'sources.exportRevision': test.vi
        .fn<StudyClient['sources.exportRevision']>()
        .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Image read interrupted')))
        .mockReturnValueOnce(Effect.promise(() => pending.promise))
        .mockReturnValue(Effect.succeed({ ...image, bytes: new Uint8Array([2]) }))
    };

    const create = test.vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:replacement');
    const revoke = test.vi.fn();

    test.vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      }
    );
    const harness = test.rpcHandlersTransport(rpc);
    const view = test.render(
      <harness.wrapper>
        <ExactAuthoredPageContent id={document.id} pageId={document.pageId} />
      </harness.wrapper>
    );
    const user = test.userEvent.setup();

    try {
      await test.screen.findByText(catalogs.english.ReaderUnavailable);
      await user.click(test.screen.getByRole('button', { name: catalogs.english.LibraryRefresh }));
      await test.screen.findByText(catalogs.english.ReaderImageUnavailable);
      test.expect(test.screen.queryByRole('img')).toBeNull();
      await user.click(
        test.screen.getByRole('button', { name: catalogs.english.ReaderRetryImage })
      );
      test
        .expect(await test.screen.findByRole('status'))
        .toHaveTextContent(catalogs.english.LoadingStudy);
      test.expect(test.screen.queryByText(catalogs.english.ReaderImageUnavailable)).toBeNull();
      await test.act(async () => {
        pending.resolve(image);
        await pending.promise;
      });
      test
        .expect(await test.screen.findByRole('img', { name: 'Retained figure' }))
        .toHaveAttribute('src', 'blob:first');
      test.expect(rpc['pages.version']).toHaveBeenCalledTimes(2);
      test.expect(rpc['sources.exportRevision']).toHaveBeenCalledTimes(2);

      for (const [input] of rpc['pages.version'].mock.calls) {
        test.expect(input).toEqual({ id: document.id });
      }

      for (const [input] of rpc['sources.exportRevision'].mock.calls) {
        test.expect(input).toEqual({
          sourceId: block.content.type === 'image' ? block.content.sourceId : undefined,
          revision: 1n
        });
      }

      await test.act(async () => {
        await harness.notify();
      });
      await test.waitFor(() =>
        test.expect(test.screen.getByRole('img')).toHaveAttribute('src', 'blob:replacement')
      );
      test.expect(revoke).toHaveBeenCalledWith('blob:first');
      view.unmount();
      test.expect(revoke).toHaveBeenCalledWith('blob:replacement');
      test.expect(create).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();

      test.vi.unstubAllGlobals();
    }
  }
);

test.stable(
  'retries one failed image without reacquiring an already displayed neighbor',
  async () => {
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
      'pages.version': test.vi
        .fn<StudyClient['pages.version']>()
        .mockReturnValue(Effect.succeed(document)),
      'sources.exportRevision': test.vi
        .fn<StudyClient['sources.exportRevision']>()
        .mockImplementation(({ sourceId }) => {
          if (sourceId === asset.sourceId && interrupted) {
            interrupted = false;

            return Effect.fail(new StudyError('transient', 'Interrupted'));
          }

          return Effect.succeed({ ...asset, sourceId });
        })
    };

    const revoke = test.vi.fn();
    let urlNumber = 0;

    test.vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = () => `blob:figure-${++urlNumber}`;
        static revokeObjectURL = revoke;
      }
    );
    const harness = test.rpcHandlersTransport(rpc);
    const view = test.render(
      <harness.wrapper>
        <ExactAuthoredPageContent id={document.id} pageId={document.pageId} />
      </harness.wrapper>
    );

    try {
      const visible = await test.screen.findByRole('img', { name: 'Available neighbor' });
      const url = visible.getAttribute('src');

      await test.userEvent
        .setup()
        .click(await test.screen.findByRole('button', { name: catalogs.english.ReaderRetryImage }));
      await test.screen.findByRole('img', { name: 'Interrupted figure' });
      test
        .expect(test.screen.getByRole('img', { name: 'Available neighbor' }))
        .toHaveAttribute('src', url);
      const calls = rpc['sources.exportRevision'].mock.calls.map(([input]) => input);

      test.expect(calls.filter((input) => input.sourceId !== asset.sourceId)).toHaveLength(1);
      test.expect(calls.filter((input) => input.sourceId === asset.sourceId)).toHaveLength(2);
      test.expect(revoke).not.toHaveBeenCalled();
      view.unmount();
      test.expect(revoke).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();

      test.vi.unstubAllGlobals();
    }
  }
);

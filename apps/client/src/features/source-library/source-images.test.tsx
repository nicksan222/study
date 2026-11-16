import { StudyError, contentSnapshotIdSchema, noteIdSchema, createBlock } from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { Providers } from '#client/app/providers.tsx';

import { authoredPage } from '../document-editing/test-support';
import { importedSource, materialRpc } from '../material-library/test/support';
import { SourcePanel } from './source-panel';

for (const context of ['current', 'historical', 'note'] as const)
  test.unit.stable(
    `renders retained source images in ${context}, isolates retry and cleans URLs across extraction identities`,
    async ({ vi, rpcHandlersTransport, render, screen, waitFor, expect, userEvent }) => {
      const rpc = materialRpc({ vi });
      const sourceId = importedSource.id;
      const base = authoredPage().version!;
      const figure = createBlock({
        type: 'image',
        sourceId,
        revision: 1,
        alt: 'Exact original figure'
      });
      const neighbor = createBlock({
        type: 'image',
        sourceId,
        revision: 2,
        alt: 'Replacement figure'
      });
      const body = { ...base.document, blocks: [figure, neighbor] };

      rpc['sources.currentExtraction'].mockReturnValue(
        Effect.succeed({
          sourceId,
          revision: 2n,
          snapshotId: base.snapshotId,
          name: 'current.png',
          document: body
        })
      );
      rpc['sources.extraction'].mockImplementation((input) =>
        Effect.succeed({ ...input, name: 'old.png', document: body })
      );
      let fail = true;

      rpc['sources.exportRevision'].mockImplementation((input) => {
        if (input.revision === 1n && fail) {
          fail = false;

          return Effect.fail(new StudyError('transient', 'Interrupted image'));
        }

        return Effect.succeed({
          ...input,
          name: 'retained.png',
          mime: 'image/png',
          bytes: new Uint8Array([Number(input.revision)])
        });
      });

      const revoke = vi.fn();
      let count = 0;

      vi.stubGlobal(
        'URL',
        class extends URL {
          static createObjectURL = () => `blob:source-${++count}`;
          static revokeObjectURL = revoke;
        }
      );
      const harness = rpcHandlersTransport(rpc);

      configureRpcTransport(harness.transport);
      const props = {
        sourceId,
        exact: context === 'historical' ? { revision: 1n, snapshotId: base.snapshotId } : undefined,
        noteId: context === 'note' ? Schema.decodeUnknownSync(noteIdSchema)(3n) : undefined,
        onOpenPage: vi.fn()
      };
      const view = render(
        <Providers transport={harness.transport}>
          <SourcePanel {...props} />
        </Providers>
      );

      try {
        await screen.findByRole('img', { name: 'Replacement figure' });

        await waitFor(() =>
          expect(screen.getByRole('img', { name: 'Replacement figure' })).toHaveAttribute(
            'src',
            expect.stringMatching(/^blob:/)
          )
        );

        const url = screen.getByRole('img', { name: 'Replacement figure' }).getAttribute('src');

        await userEvent
          .setup()
          .click(await screen.findByRole('button', { name: catalogs.english.ReaderRetryImage }));
        await waitFor(() =>
          expect(screen.getByRole('img', { name: 'Exact original figure' })).toHaveAttribute(
            'src',
            expect.stringMatching(/^blob:/)
          )
        );
        expect(screen.getByRole('img', { name: 'Replacement figure' })).toHaveAttribute('src', url);
        expect(rpc['sources.exportRevision'].mock.calls.map(([v]) => v.revision)).toEqual([
          1n,
          2n,
          1n
        ]);
        expect(revoke).not.toHaveBeenCalled();
        // Another extraction of the same original must acquire its own asset lifetime.
        const next = {
          ...props,
          exact: {
            revision: 1n,
            snapshotId: Schema.decodeUnknownSync(contentSnapshotIdSchema)(999n)
          }
        };

        view.rerender(
          <Providers transport={harness.transport}>
            <SourcePanel key="next" {...next} />
          </Providers>
        );
        await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
        await screen.findByRole('img', { name: 'Exact original figure' });
        await waitFor(() => expect(rpc['sources.exportRevision']).toHaveBeenCalledTimes(5));
        await waitFor(() => {
          for (const name of ['Exact original figure', 'Replacement figure'])
            expect(screen.getByRole('img', { name })).toHaveAttribute(
              'src',
              expect.stringMatching(/^blob:/)
            );
        });
        view.unmount();
        expect(count).toBe(4);
        expect(new Set(revoke.mock.calls.map(([url]) => url)).size).toBe(4);
        expect(revoke).toHaveBeenCalledTimes(count);
        expect(rpc['sources.extraction']).toHaveBeenLastCalledWith(
          next.exact && { sourceId, ...next.exact }
        );
      } finally {
        view.unmount();

        vi.unstubAllGlobals();
      }
    }
  );

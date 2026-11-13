import { StudyError } from '@study/contracts/errors';
import { contentSnapshotIdSchema, noteIdSchema } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { Providers } from '#client/app/providers.tsx';
import { runRequest } from '#client/lib/effect/runtime.ts';
import { createStudyQueryClient } from '#client/lib/query-client.ts';
import type { StudyClient } from '#client/lib/study-client/client.ts';
import { toStudyError } from '#client/lib/study-client/errors.ts';
import { request } from '#client/lib/study-client/request.ts';

import { authoredPage } from '../document-editing/test-support';
import { importedSource, materialRpc } from '../material-library/test/support';
import { SourcePanel } from './source-panel';

vi.mock('#client/lib/study-client/request.ts', () => ({ request: vi.fn() }));

for (const context of ['current', 'historical', 'note'] as const)
  testStable(
    `renders retained source images in ${context}, isolates retry and cleans URLs across extraction identities`,
    async () => {
      const rpc = materialRpc();
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
      vi.mocked(request).mockImplementation((invoke, signal) =>
        runRequest(
          invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)),
          signal
        )
      );
      const revoke = vi.fn();
      let count = 0;

      vi.stubGlobal(
        'URL',
        class extends URL {
          static createObjectURL = () => `blob:source-${++count}`;
          static revokeObjectURL = revoke;
        }
      );
      const cache = createStudyQueryClient();
      const props = {
        sourceId,
        exact: context === 'historical' ? { revision: 1n, snapshotId: base.snapshotId } : undefined,
        noteId: context === 'note' ? Schema.decodeUnknownSync(noteIdSchema)(3n) : undefined,
        onOpenPage: vi.fn()
      };
      const view = render(
        <Providers queryClient={cache}>
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
          <Providers queryClient={cache}>
            <SourcePanel key="next" {...next} />
          </Providers>
        );
        await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
        await screen.findByRole('img', { name: 'Exact original figure' });
        await waitFor(() => expect(rpc['sources.exportRevision']).toHaveBeenCalledTimes(5));
        view.unmount();
        expect(revoke).toHaveBeenCalledTimes(4);
        expect(rpc['sources.extraction']).toHaveBeenLastCalledWith(
          next.exact && { sourceId, ...next.exact }
        );
      } finally {
        view.unmount();
        cache.clear();
        vi.unstubAllGlobals();
      }
    }
  );

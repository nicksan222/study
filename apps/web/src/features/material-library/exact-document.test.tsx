import { StudyError } from '@study/contracts/errors';
import {
  materialVersionDocumentSchema,
  materialVersionImageSchema
} from '@study/contracts/materials/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { runRequest } from '#web/lib/effect/runtime.ts';
import { createStudyQueryClient } from '#web/lib/query-client.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { ExactDocument } from './exact-document';
import { versionId } from './identity';
import { deferred, exactDocument } from './test/support';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

testStable(
  'retries the exact document and individual image, distinguishes loading, and releases URLs on replacement/unmount',
  async () => {
    const document = exactDocument();
    const block = createBlock({
      type: 'image',
      sourceId: Schema.decodeUnknownSync(materialVersionImageSchema)({
        sourceId: 7n,
        revision: 1,
        mime: 'image/png',
        bytes: new Uint8Array()
      }).sourceId,
      revision: 1,
      alt: 'Retained figure'
    });
    const value = Schema.decodeUnknownSync(materialVersionDocumentSchema)({
      ...document,
      document: { ...document.document, blocks: [block] }
    });
    const image = Schema.decodeUnknownSync(materialVersionImageSchema)({
      sourceId: 7n,
      revision: 1,
      mime: 'image/png',
      bytes: new Uint8Array([1])
    });
    const pending = deferred<typeof image>();
    const rpc = {
      'materials.materialVersionDocument': vi
        .fn<StudyClient['materials.materialVersionDocument']>()
        .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Document read interrupted')))
        .mockReturnValue(Effect.succeed(value)),
      'materials.materialVersionImage': vi
        .fn<StudyClient['materials.materialVersionImage']>()
        .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Image read interrupted')))
        .mockReturnValueOnce(Effect.promise(() => pending.promise))
        .mockReturnValue(Effect.succeed({ ...image, bytes: new Uint8Array([2]) }))
    };

    vi.mocked(request).mockImplementation((invoke, signal) =>
      runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
    );
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
    const client = createStudyQueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <ExactDocument id={versionId('101')} />
      </QueryClientProvider>
    );
    const user = userEvent.setup();

    try {
      await screen.findByText(catalogs.english.ReaderUnavailable);
      await user.click(screen.getByRole('button', { name: catalogs.english.LibraryRefresh }));
      await screen.findByText(catalogs.english.ReaderImageUnavailable);
      expect(screen.queryByRole('img')).toBeNull();
      await user.click(screen.getByRole('button', { name: catalogs.english.ReaderRetryImage }));
      expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LoadingStudy);
      expect(screen.queryByText(catalogs.english.ReaderImageUnavailable)).toBeNull();
      await act(async () => {
        pending.resolve(image);
        await pending.promise;
      });
      expect(await screen.findByRole('img', { name: 'Retained figure' })).toHaveAttribute(
        'src',
        'blob:first'
      );
      expect(rpc['materials.materialVersionDocument']).toHaveBeenCalledTimes(2);
      expect(rpc['materials.materialVersionImage']).toHaveBeenCalledTimes(2);

      for (const [input] of rpc['materials.materialVersionDocument'].mock.calls) {
        expect(input).toEqual({ id: versionId('101') });
      }

      for (const [input] of rpc['materials.materialVersionImage'].mock.calls) {
        expect(input).toEqual({ id: versionId('101'), documentId: value.id, blockId: block.id });
      }

      await act(async () => {
        await client.invalidateQueries({ queryKey: ['materials', 'image'] });
      });
      await waitFor(() =>
        expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:replacement')
      );
      expect(revoke).toHaveBeenCalledWith('blob:first');
      view.unmount();
      expect(revoke).toHaveBeenCalledWith('blob:replacement');
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      client.clear();
      vi.unstubAllGlobals();
    }
  }
);

testStable(
  'retries one failed image without reacquiring an already displayed neighbor',
  async () => {
    const base = exactDocument();
    const asset = Schema.decodeUnknownSync(materialVersionImageSchema)({
      sourceId: 7n,
      revision: 1,
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
      sourceId: asset.sourceId,
      revision: 1,
      alt: 'Available neighbor'
    });
    const document = { ...base, document: { ...base.document, blocks: [first, neighbor] } };
    let interrupted = true;
    const rpc = {
      'materials.materialVersionDocument': vi
        .fn<StudyClient['materials.materialVersionDocument']>()
        .mockReturnValue(Effect.succeed(document)),
      'materials.materialVersionImage': vi
        .fn<StudyClient['materials.materialVersionImage']>()
        .mockImplementation(({ blockId }) => {
          if (blockId === first.id && interrupted) {
            interrupted = false;

            return Effect.fail(new StudyError('transient', 'Interrupted'));
          }

          return Effect.succeed(asset);
        })
    };

    vi.mocked(request).mockImplementation((invoke, signal) =>
      runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
    );
    const revoke = vi.fn();
    let urlNumber = 0;

    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = () => `blob:figure-${++urlNumber}`;
        static revokeObjectURL = revoke;
      }
    );
    const client = createStudyQueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <ExactDocument id={versionId('101')} />
      </QueryClientProvider>
    );

    try {
      const visible = await screen.findByRole('img', { name: 'Available neighbor' });
      const url = visible.getAttribute('src');

      await userEvent
        .setup()
        .click(await screen.findByRole('button', { name: catalogs.english.ReaderRetryImage }));
      await screen.findByRole('img', { name: 'Interrupted figure' });
      expect(screen.getByRole('img', { name: 'Available neighbor' })).toHaveAttribute('src', url);
      const calls = rpc['materials.materialVersionImage'].mock.calls.map(([input]) => input);

      expect(calls.filter((input) => input.blockId === neighbor.id)).toHaveLength(1);
      expect(calls.filter((input) => input.blockId === first.id)).toHaveLength(2);
      expect(revoke).not.toHaveBeenCalled();
      view.unmount();
      expect(revoke).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      client.clear();
      vi.unstubAllGlobals();
    }
  }
);

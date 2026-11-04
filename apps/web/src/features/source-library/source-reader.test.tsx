import { StudyError } from '@study/contracts/errors';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import { assert, expect, vi } from 'vite-plus/test';

import { materialRpc, mountLibraryRoute, importedSource } from '../material-library/test/support';
vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
testStable(
  'keeps unavailable historical extraction unavailable without falling back to current content or bytes',
  async () => {
    const rpc = materialRpc();

    rpc['sources.extraction'].mockReturnValue(
      Effect.fail(new StudyError('not_found', 'Revision unavailable'))
    );
    mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
      catalogs.english.ReaderUnavailable
    );
    expect(screen.queryByText('Current extraction 41')).toBeNull();
    expect(screen.getByRole('button', { name: catalogs.english.ReaderOriginal })).toBeEnabled();
    expect(rpc['sources.extraction']).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      revision: 1n,
      snapshotId: 1101n
    });
    expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    expect(rpc['sources.currentExtraction']).not.toHaveBeenCalled();
    expect(rpc['sources.exportRevision']).not.toHaveBeenCalled();
    expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
  }
);

testStable(
  'exports the selected historical version with its exact retained bytes, MIME and filename',
  async () => {
    const rpc = materialRpc();
    const bytes = new Uint8Array([0, 128, 255]);

    rpc['sources.exportRevision'].mockReturnValue(
      Effect.succeed({
        sourceId: importedSource.id,
        revision: 1n,
        name: importedSource.name,
        mime: importedSource.mime,
        bytes
      })
    );
    const createObjectURL = vi
      .fn<(blob: Blob) => string>()
      .mockReturnValue('blob:historical-original');
    const revokeObjectURL = vi.fn();
    const timers = vi.spyOn(globalThis, 'setTimeout');

    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      }
    );
    let delivery: { href: string; filename: string } | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      delivery = { href: this.href, filename: this.download };
    });

    try {
      mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
      await screen.findByText('Historical extraction');
      expect(screen.queryByText('Current extraction 41')).toBeNull();
      const original = screen.getByRole('button', { name: catalogs.english.ReaderOriginal });

      await userEvent.setup().click(original);
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      const blob = createObjectURL.mock.calls[0]![0];

      expect(blob.type).toBe(importedSource.mime);
      const retained = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

      expect(new Uint8Array(retained)).toEqual(bytes);
      expect(delivery).toEqual({ href: 'blob:historical-original', filename: importedSource.name });
      expect(rpc['sources.exportRevision']).toHaveBeenCalledExactlyOnceWith({
        sourceId: importedSource.id,
        revision: 1n
      });
      expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
      await waitFor(() => expect(original).toBeEnabled(), { timeout: 2500 });
      const scheduled = timers.mock.calls.findLastIndex(([, delay]) => delay === 30000);

      expect(scheduled).toBeGreaterThanOrEqual(0);
      const callback = timers.mock.calls[scheduled]![0];

      clearTimeout(timers.mock.results[scheduled]!.value);

      assert.isFunction(callback, 'Expected a download cleanup callback');

      callback();
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:historical-original');
    } finally {
      timers.mockRestore();
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  }
);

testStable(
  'reports an unavailable historical original without requesting a current-version or Source fallback',
  async () => {
    const rpc = materialRpc();

    rpc['sources.exportRevision'].mockReturnValue(
      Effect.fail(new StudyError('not_found', 'Original unavailable'))
    );
    mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    const original = await screen.findByRole('button', { name: catalogs.english.ReaderOriginal });

    await userEvent.setup().click(original);
    expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(
      catalogs.english.ReaderOriginalUnavailable
    );
    expect(rpc['sources.exportRevision']).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      revision: 1n
    });
    expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
    expect(screen.getByText('Historical extraction')).toBeInTheDocument();
  }
);
